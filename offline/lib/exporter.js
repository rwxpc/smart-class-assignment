/**
 * exporter.js — 服务端 Excel 导出（名单导出 / 完整报告）
 * 使用前端自带的 SheetJS (xlsx.full.min.js) 在 Node 中生成 xlsx
 */
'use strict';
const XLSX = require('../public/assets/xlsx.full.min.js');
const { getScoreSubjects, getWKeys, getBKeys } = require('./results');

function aoaToSheet(aoa, colWidths) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (colWidths) ws['!cols'] = colWidths.map(w => ({ wch: w }));
    return ws;
}

/**
 * 导出学生名单
 * @param {Array} students
 * @param {object} opts { w_keys, b_keys, extra_keys }
 */
function buildRosterWorkbook(students, opts) {
    opts = opts || {};
    const wKeys = opts.w_keys || [];
    const bKeys = opts.b_keys || [];
    const extraKeys = opts.extra_keys || [];

    const headers = ['姓名', '性别', ...extraKeys, '总分', ...wKeys, ...bKeys, '绑定组', '互斥组', '预设班级', '班级'];
    const aoa = [headers];
    for (const s of students) {
        const row = [
            s.name, s.gender,
            ...extraKeys.map(k => (s.extra_scores && s.extra_scores[k] !== undefined) ? s.extra_scores[k] : ''),
            Number(s.total_score) || 0,
            ...wKeys.map(k => (s.w_columns && s.w_columns[k]) || ''),
            ...bKeys.map(k => (s.b_columns && s.b_columns[k]) || ''),
            s.bind_group || 0, s.exclude_group || 0,
            s.is_preset === 1 ? s.class_id : '',
            s.class_id > 0 ? s.class_id + '班' : ''
        ];
        aoa.push(row);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa, headers.map(h => h.length > 4 ? 12 : 8)), '学生名单');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

/**
 * 导出完整分班报告
 * Sheets：全校学生信息总表 / 统计汇总 / 各班分表
 */
function buildResultsWorkbook(students, config, result) {
    const wb = XLSX.utils.book_new();
    const subjects = getScoreSubjects(students);
    const cn = config.class_num;
    // W 前缀列（参与均衡）/ B 前缀列（不参与成绩计算）——报告中随学生信息一并导出
    const wKeys = getWKeys(students);
    const bKeys = getBKeys(students);

    // Sheet 1: 全校学生信息总表（按班级排序）
    const sorted = students.slice().sort((a, b) => (a.class_id - b.class_id) || (b.total_score - a.total_score));
    const head1 = ['班级', '姓名', '性别', ...subjects, '总分', ...wKeys, ...bKeys, '绑定组', '互斥组', '预设'];
    const aoa1 = [head1];
    for (const s of sorted) {
        aoa1.push([
            s.class_id > 0 ? s.class_id + '班' : '未分配',
            s.name, s.gender,
            ...subjects.map(sub => (s.extra_scores && s.extra_scores[sub] !== undefined) ? s.extra_scores[sub] : ''),
            Number(s.total_score) || 0,
            ...wKeys.map(k => (s.w_columns && s.w_columns[k] !== undefined) ? s.w_columns[k] : ''),
            ...bKeys.map(k => (s.b_columns && s.b_columns[k] !== undefined) ? s.b_columns[k] : ''),
            s.bind_group || 0, s.exclude_group || 0,
            s.is_preset === 1 ? '是' : ''
        ]);
    }
    XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa1, [8, 10, 6, ...subjects.map(() => 8), 8, ...wKeys.map(() => 8), ...bKeys.map(() => 8), 8, 8, 8]), '全校学生信息总表');

    // Sheet 2: 统计汇总（各班各科均分）
    const head2 = ['班级', '人数', ...subjects.map(s => s + '均分'), '总分均分', '男生', '女生'];
    const aoa2 = [head2];
    for (const c of result.classes) {
        aoa2.push([c.class_name, c.count, ...subjects.map(sub => c.subject_avgs[sub] !== undefined ? c.subject_avgs[sub] : '-'), c.avg_score, c.male_count, c.female_count]);
    }
    aoa2.push(['全校汇总', result.total_students,
        ...subjects.map(sub => {
            const ws = result.classes.reduce((s, c) => s + ((c.subject_avgs[sub] !== '-' ? c.subject_avgs[sub] : 0) * c.count), 0);
            return result.total_students ? (ws / result.total_students).toFixed(2) : '-';
        }),
        result.overall_avg,
        result.classes.reduce((s, c) => s + c.male_count, 0),
        result.classes.reduce((s, c) => s + c.female_count, 0)]);
    // 极差行
    const rng = arr => (Math.max(...arr) - Math.min(...arr)).toFixed(2);
    aoa2.push(['📏 极差', '-',
        ...subjects.map(sub => rng(result.classes.map(c => c.subject_avgs[sub] === '-' ? 0 : c.subject_avgs[sub]))),
        rng(result.classes.map(c => c.avg_score)),
        rng(result.classes.map(c => c.male_count)),
        rng(result.classes.map(c => c.female_count))]);
    XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa2, [10, 8, ...subjects.map(() => 10), 10, 8, 8]), '统计汇总');

    // 学科优秀生分布（如有）
    if (result.subject_distribution && result.subject_distribution.length) {
        const headS = ['学科 (分数线)', ...Array.from({ length: cn }, (_, i) => (i + 1) + '班'), '总计', '极差'];
        const aoaS = [headS];
        for (const sd of result.subject_distribution) {
            aoaS.push([`${sd.name} (≥${sd.threshold}分)`, ...sd.class_counts, sd.total, sd.range]);
        }
        XLSX.utils.book_append_sheet(wb, aoaToSheet(aoaS, [18, ...Array(cn).fill(8), 8, 8]), '学科优秀生分布');
    }

    // 各班分表（含 W/B 前缀列）
    for (const c of result.classes) {
        const headC = ['序号', '姓名', '性别', ...subjects, '总分', ...wKeys, ...bKeys, '标签'];
        const aoaC = [[c.class_name + ' · ' + c.count + '人 · 总分均分 ' + c.avg_score], headC];
        c.students.forEach((s, i) => {
            const stu = students.find(x => x.id === s.id);
            aoaC.push([
                i + 1, s.name, s.gender,
                ...subjects.map(sub => (stu && stu.extra_scores && stu.extra_scores[sub] !== undefined) ? stu.extra_scores[sub] : ''),
                s.total_score,
                ...wKeys.map(k => (stu && stu.w_columns && stu.w_columns[k] !== undefined) ? stu.w_columns[k] : ''),
                ...bKeys.map(k => (stu && stu.b_columns && stu.b_columns[k] !== undefined) ? stu.b_columns[k] : ''),
                s.label || ''
            ]);
        });
        const avgRow = ['均分', '', '', ...subjects.map(sub => c.subject_avgs[sub] === '-' ? '-' : c.subject_avgs[sub]), c.avg_score,
            ...wKeys.map(() => ''), ...bKeys.map(() => ''), ''];
        aoaC.push(avgRow);
        XLSX.utils.book_append_sheet(wb, aoaToSheet(aoaC, [6, 10, 6, ...subjects.map(() => 8), 8, ...wKeys.map(() => 8), ...bKeys.map(() => 8), 12]), (c.class_id + '班').substring(0, 31));
    }

    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

module.exports = { buildRosterWorkbook, buildResultsWorkbook };
