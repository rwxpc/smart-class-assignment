/**
 * importer.js — Excel 导入解析（对应服务端 action=import）
 *
 * 列识别规则：
 *  - 姓名/name → name；性别/gender → gender；总分 → total_score
 *  - 绑定组 → bind_group；互斥组 → exclude_group；预设班级/预设 → preset_class（多个则确认）
 *  - 已知科目名（语文数学英语物理化学生物政治历史地理）→ subject
 *  - W/w 前缀 → w（参与均衡）；B/b 前缀 → b（仅展示）
 *  - 其他数字列 → subject（suspicious，需确认）；其他文本列 → ignore（suspicious）
 */
'use strict';
const XLSX = require('../public/assets/xlsx.full.min.js');

const KNOWN_SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学'];

function normHeader(h) {
    return String(h == null ? '' : h).replace(/\s+/g, '').replace(/：/g, ':');
}

function isNumericCol(samples) {
    let sawNum = false, sawNonEmpty = false;
    for (const v of samples) {
        if (v === '' || v == null) continue;
        sawNonEmpty = true;
        const n = Number(v);
        if (!isNaN(n) && String(v).trim() !== '') sawNum = true;
        else return false;
    }
    return sawNonEmpty && sawNum;
}

/**
 * 识别每个表头的默认角色
 * @returns array of {header, samples, numeric, default, suspicious}
 */
function classifyColumns(headers, rows) {
    return headers.map(h => {
        const key = normHeader(h);
        const samples = rows.slice(0, 5).map(r => String(r[h] == null ? '' : r[h]).trim()).filter(v => v !== '').slice(0, 3);
        const numeric = isNumericCol(rows.slice(0, 30).map(r => r[h]));
        let role = 'ignore', suspicious = false;

        if (key === '姓名' || /^name$/i.test(key)) role = 'name';
        else if (key === '性别' || /^gender$/i.test(key)) role = 'gender';
        else if (key === '总分' || key === '总成绩' || /^total(_?score)?$/i.test(key)) role = 'total_score';
        else if (key === '绑定组' || /^bind(_?group)?$/i.test(key)) role = 'bind_group';
        else if (key === '互斥组' || /^exclude(_?group)?$/i.test(key)) role = 'exclude_group';
        else if (key === '预设班级' || key === '预设' || key === '班级') { role = 'preset_class'; }
        else if (/^[wW]/.test(key) && key.length > 1) role = 'w';
        else if (/^[bB]/.test(key) && key.length > 1) role = 'b';
        else if (KNOWN_SUBJECTS.includes(key)) role = 'subject';
        else if (numeric) { role = 'subject'; suspicious = true; }
        else { role = 'ignore'; suspicious = true; }

        return { header: h, samples, numeric, default: role, suspicious };
    });
}

/**
 * 解析上传的 xlsx Buffer
 * @param {Buffer} buf
 * @param {object} opts { column_map: {header:role}, preset_column, request_column_review }
 */
function parseWorkbook(buf, opts) {
    opts = opts || {};
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { ok: false, msg: 'Excel 中没有工作表' };
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) return { ok: false, msg: 'Excel 中没有数据行' };
    const headers = Object.keys(rows[0]);
    const allCols = classifyColumns(headers, rows);

    // 应用用户确认的列映射
    if (opts.column_map) {
        for (const col of allCols) {
            if (opts.column_map[col.header]) col.default = opts.column_map[col.header];
        }
    }

    const byRole = r => allCols.filter(c => c.default === r);
    const nameCols = byRole('name');
    const genderCols = byRole('gender');
    const totalCols = byRole('total_score');
    const bindCols = byRole('bind_group');
    const exclCols = byRole('exclude_group');
    const presetCols = byRole('preset_class');
    const subjectCols = byRole('subject');
    const wCols = byRole('w');
    const bCols = byRole('b');

    // 无姓名或性别列 → 校验错误
    const validation_errors = [];
    if (!nameCols.length) validation_errors.push({ msg: '未找到「姓名」列' });
    if (!genderCols.length) validation_errors.push({ msg: '未找到「性别」列' });
    if (validation_errors.length) {
        return { ok: false, validation_errors, msg: '导入校验失败', column_review: opts.request_column_review ? allCols : allCols.filter(c => c.suspicious) };
    }

    // 多个预设相关列 → 需确认按哪一列导入
    const presetLike = allCols.filter(c => ['预设班级', '预设', '班级'].includes(normHeader(c.header)));
    if (presetLike.length > 1 && !opts.preset_column) {
        return {
            ok: false, needs_preset_pick: true,
            preset_columns_confirm: presetLike.map(c => ({ header: c.header, samples: c.samples })),
            msg: '检测到多个预设相关列'
        };
    }
    let presetCol = presetCols[0] || null;
    if (presetLike.length > 1 && opts.preset_column) {
        presetCol = presetLike.find(c => c.header === opts.preset_column) || null;
    }

    // 列用途确认请求
    const review = opts.request_column_review ? allCols : allCols.filter(c => c.suspicious);
    if (review.length > 0 && !opts.column_map && !opts.column_review_done) {
        return { ok: false, needs_column_review: true, column_review: review, msg: '需要确认列用途' };
    }

    const subjects = subjectCols.map(c => normHeader(c.header));
    const hasScores = subjects.length > 0 || totalCols.length > 0;

    // 无任何分数列 → 无分数模式确认
    if (!hasScores && !opts.scoreless_confirm) {
        return { ok: false, no_scores_detected: true, msg: '未检测到学科成绩列和总分列' };
    }

    // 逐行构建学生
    const students = [];
    const errors = [];
    let rowNum = 1; // 数据从第2行开始
    for (const r of rows) {
        rowNum++;
        const get = col => col ? String(r[col.header] == null ? '' : r[col.header]).trim() : '';
        const name = get(nameCols[0]).replace(/\s+/g, '');
        const genderRaw = get(genderCols[0]);
        const gender = genderRaw.startsWith('男') ? '男' : genderRaw.startsWith('女') ? '女' : '';

        if (!name) continue; // 空行跳过
        if (name.length < 2 || name.length > 20) { errors.push(`第${rowNum}行 姓名长度须为2~20个字符：「${name}」`); continue; }
        if (!gender) { errors.push(`第${rowNum}行 性别只能填"男"或"女"：「${name}」`); continue; }

        const stu = {
            name, gender,
            extra_scores: {}, w_columns: {}, b_columns: {},
            bind_group: 0, exclude_group: 0,
            is_preset: 0, class_id: 0,
            total_score: 0, label: '', is_boarding: 0
        };

        // 学科成绩
        for (const c of subjectCols) {
            const v = get(c);
            if (v !== '') { const n = Number(v); if (!isNaN(n)) stu.extra_scores[normHeader(c.header)] = n; }
        }
        // 总分
        if (totalCols.length) {
            const v = get(totalCols[0]);
            if (v !== '') { const n = Number(v); if (!isNaN(n)) stu.total_score = n; }
        } else {
            // 无总分列 → 自动求和
            stu.total_score = Object.values(stu.extra_scores).reduce((s, x) => s + x, 0);
        }
        // 绑定/互斥
        for (const [col, key] of [[bindCols[0], 'bind_group'], [exclCols[0], 'exclude_group']]) {
            const v = get(col);
            if (v !== '') { const n = parseInt(v, 10); if (!isNaN(n) && n > 0) stu[key] = n; }
        }
        // 预设班级
        if (presetCol) {
            const v = get(presetCol);
            if (v !== '') {
                const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
                if (!isNaN(n) && n > 0) { stu.is_preset = 1; stu.class_id = n; stu._preset_raw = n; }
            }
        }
        // W / B 列
        for (const c of wCols) { const v = get(c); if (v !== '') stu.w_columns[normHeader(c.header).substring(1)] = v; }
        for (const c of bCols) { const v = get(c); if (v !== '') stu.b_columns[normHeader(c.header).substring(1)] = v; }

        // label：取第一个 B 列值（展示用）
        const bFirst = bCols[0] ? get(bCols[0]) : '';
        stu.label = bFirst;

        students.push(stu);
    }

    if (errors.length) {
        return { ok: false, validation_errors: errors.map(m => ({ msg: m })), msg: `发现 ${errors.length} 处数据问题`, column_review: review };
    }

    // 总分一致性校验（有学科列 + 有总分列时）
    if (subjectCols.length && totalCols.length && !opts.confirm_total) {
        const mismatches = [];
        for (const s of students) {
            const calc = Object.values(s.extra_scores).reduce((a, b) => a + b, 0);
            if (Math.abs(calc - s.total_score) > 0.01) {
                mismatches.push({ name: s.name, user_total: s.total_score, calc_total: Number(calc.toFixed(2)) });
            }
        }
        if (mismatches.length) {
            return { ok: false, needs_total_confirm: true, total_mismatches: mismatches, mismatch_count: mismatches.length, msg: `发现 ${mismatches.length} 人的总分与各科之和不一致` };
        }
    }
    if (opts.confirm_total && !opts.use_imported_total) {
        // 使用计算总分
        for (const s of students) s.total_score = Number(Object.values(s.extra_scores).reduce((a, b) => a + b, 0).toFixed(2));
    }

    return {
        ok: true, students, subjects,
        wKeys: wCols.map(c => normHeader(c.header).substring(1)),
        bKeys: bCols.map(c => normHeader(c.header).substring(1)),
        hasScores
    };
}

module.exports = { parseWorkbook, KNOWN_SUBJECTS, classifyColumns };
