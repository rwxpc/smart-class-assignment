/**
 * server.js — 中小学智能分班管理系统 · 离线版服务端
 *
 * 用 Node.js 逆向还原原 PHP 后端的全部接口，前端页面原样保留。
 * 启动：node server.js  （默认 http://localhost:8080）
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const store = require('./lib/store');
const { parseWorkbook } = require('./lib/importer');
const scheduler = require('./lib/scheduler');
const results = require('./lib/results');
const exporter = require('./lib/exporter');

const PORT = parseInt(process.env.PORT || '8080', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE_NAME = 'PHPSESSID';

const appTemplate = fs.readFileSync(path.join(PUBLIC_DIR, 'app.html'), 'utf8');
const loginHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'login.html'), 'utf8');

// ── 工具 ──
function json(res, obj, status) {
    const body = JSON.stringify(obj);
    res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
}
function parseCookies(req) {
    const out = {};
    const raw = req.headers.cookie || '';
    raw.split(';').forEach(p => {
        const i = p.indexOf('=');
        if (i > 0) out[p.substring(0, i).trim()] = decodeURIComponent(p.substring(i + 1).trim());
    });
    return out;
}
function getSessionUser(req) {
    const cookies = parseCookies(req);
    const sid = cookies[COOKIE_NAME];
    if (!sid) return null;
    const sess = store.getSession(sid);
    if (!sess) return null;
    const user = store.getUserById(sess.userId);
    if (!user || user.is_disabled == 1) return null;
    return { user, sess, sid };
}

// ── 请求体解析 ──
function parseBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (size > 50 * 1024 * 1024) { reject(new Error('文件过大')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            const buf = Buffer.concat(chunks);
            const ctype = req.headers['content-type'] || '';
            if (ctype.includes('application/json')) {
                try { resolve({ json: JSON.parse(buf.toString('utf8') || '{}') }); }
                catch (e) { resolve({ json: {} }); }
            } else if (ctype.includes('multipart/form-data')) {
                resolve(parseMultipart(buf, ctype));
            } else if (ctype.includes('application/x-www-form-urlencoded') || !ctype) {
                const fields = {};
                const text = buf.toString('utf8');
                for (const pair of text.split('&')) {
                    if (!pair) continue;
                    const i = pair.indexOf('=');
                    const k = decodeURIComponent(pair.substring(0, i).replace(/\+/g, ' '));
                    const v = decodeURIComponent(pair.substring(i + 1).replace(/\+/g, ' '));
                    // 支持 a[b] 形式（前端不使用，忽略）
                    fields[k] = v;
                }
                resolve({ fields });
            } else {
                resolve({ raw: buf });
            }
        });
        req.on('error', reject);
    });
}

function parseMultipart(buf, ctype) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
    if (!m) return { fields: {}, file: null };
    const boundary = '--' + (m[1] || m[2]);
    const fields = {};
    let file = null;
    const bBoundary = Buffer.from(boundary);
    let pos = buf.indexOf(bBoundary);
    while (pos !== -1) {
        const next = buf.indexOf(bBoundary, pos + bBoundary.length);
        if (next === -1) break;
        // part 内容：boundary 之后 \r\n ... \r\n 前是 header，\r\n\r\n 后是数据，结尾 \r\n
        let start = pos + bBoundary.length;
        if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
        const partEnd = next - 2; // 去掉结尾 \r\n
        const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'), start);
        if (headerEnd !== -1 && headerEnd < partEnd) {
            const headerText = buf.slice(start, headerEnd).toString('utf8');
            const data = buf.slice(headerEnd + 4, partEnd);
            const nameM = /name="([^"]*)"/i.exec(headerText);
            const fileM = /filename="([^"]*)"/i.exec(headerText);
            const ctm = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
            if (nameM) {
                if (fileM && fileM[1]) {
                    file = { field: nameM[1], filename: decodeURIComponent(fileM[1] || ''), data, contentType: ctm ? ctm[1].trim() : '' };
                } else {
                    fields[nameM[1]] = data.toString('utf8');
                }
            }
        }
        pos = next;
    }
    return { fields, file };
}

// ── 学生排序辅助 ──
function renumberStudents(students) {
    students.forEach((s, i) => { s.id = i + 1; });
}

// ── 主应用 HTML 渲染 ──
function renderApp(user, sess) {
    const userId = user.id;
    const students = store.loadStudents(userId);
    const config = store.loadConfig(userId);
    const runState = store.loadRunState(userId);
    const subjects = results.getScoreSubjects(students);
    const subjectScores = {};
    for (const sub of subjects) {
        subjectScores[sub] = students.map(s => (s.extra_scores && s.extra_scores[sub] !== undefined) ? Number(s.extra_scores[sub]) : 0);
    }
    const isAdmin = user.is_admin == 1;
    const adminLink = isAdmin ? '<a data-page="admin" onclick="switchPage(\'admin\')">\n            <span class="icon">👑</span> <span>用户管理</span>\n        </a>' : '';

    let html = appTemplate;
    html = html.replace('{{CSRF}}', sess.csrf);
    html = html.replace('{{DISPLAY_NAME}}', escapeHtml(user.display_name || user.username));
    html = html.replace('{{USERNAME}}', escapeHtml(user.username));
    html = html.replace('{{STATUS_TEXT}}', runState.status || 'idle');
    html = html.replace('{{SUBJECT_SCORES}}', JSON.stringify(subjectScores));
    html = html.replace('{{SCORE_SUBJECTS}}', JSON.stringify(subjects));
    html = html.replace('{{STATUS}}', runState.status || 'idle');
    html = html.replace('{{MOCK_ALERT}}', students.length === 0
        ? '<div class="alert alert-info">📌 当前没有学生数据，建议先生成模拟数据以体验系统功能。</div>' : '');
    html = html.replace('{{ADMIN_LINK}}', adminLink);
    return html;
}
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── 状态辅助 ──
function statusPayload(user) {
    const students = store.loadStudents(user.id);
    const config = store.loadConfig(user.id);
    const runState = store.loadRunState(user.id);
    const assigned = students.filter(s => s.class_id > 0).length;
    const subjects = results.getScoreSubjects(students);
    const subjectScores = {};
    for (const sub of subjects) {
        subjectScores[sub] = students.map(s => (s.extra_scores && s.extra_scores[sub] !== undefined) ? Number(s.extra_scores[sub]) : 0);
    }
    return {
        code: 200,
        status: runState.status,
        progress: runState.progress,
        class_num: config.class_num,
        total_students: students.length,
        assigned,
        unassigned: students.length - assigned,
        data_count: students.length,
        multi_run_count: config.multi_run_count,
        opt2_time_limit: config.opt2_time_limit,
        vba_perturb_ratio: config.vba_perturb_ratio,
        vba_high_count: config.vba_high_count,
        vba_low_count: config.vba_low_count,
        vba_gender_swap: config.vba_gender_swap,
        vba_gender_separate_snake: config.vba_gender_separate_snake,
        vba_scheduling_mode: config.vba_scheduling_mode,
        vba_judgment_mode: config.vba_judgment_mode,
        vba_range_fix_mode: config.vba_range_fix_mode,
        vba_authorized_modes: ['fast', 'balanced', 'precision'],
        vba_constrain_bands: config.vba_constrain_bands,
        vba_band_seed: config.vba_band_seed || '',
        vba_combo1: config.vba_combo1,
        vba_combo2: config.vba_combo2,
        use_subject_balance: config.use_subject_balance,
        subject_thresholds: config.subject_thresholds || [],
        subject_scores: subjectScores
    };
}

// ══════════════════ API 路由 ══════════════════
async function handleApi(req, res, action, body, query, auth) {
    const { user, sess } = auth;
    const userId = user.id;

    // ── CSRF 校验（POST + 已登录；export_roster 由前端直接下载无法携带 token，豁免） ──
    if (req.method === 'POST' && action !== 'export_roster') {
        const token = (body.fields && body.fields.csrf_token) || (body.json && body.json.csrf_token) || query.get('csrf_token') || '';
        if (!token || token !== sess.csrf) {
            return json(res, { code: 403, msg: 'CSRF 校验失败，请刷新页面重试' });
        }
    }

    // ── 学生数据 ──
    if (action === 'students') {
        const students = store.loadStudents(userId);
        const config = store.loadConfig(userId);
        const page = Math.max(1, parseInt(query.get('page') || body.fields.page || '1', 10) || 1);
        const perPage = Math.min(10000, Math.max(1, parseInt(query.get('per_page') || body.fields.per_page || '20', 10) || 20));
        const start = (page - 1) * perPage;
        const data = students.slice(start, start + perPage).map(s => ({
            id: s.id, name: s.name, gender: s.gender,
            total_score: s.total_score,
            bind_group: s.bind_group || 0, exclude_group: s.exclude_group || 0,
            class_id: s.class_id || 0, is_preset: s.is_preset || 0,
            w_columns: JSON.stringify(s.w_columns || {}),
            b_columns: JSON.stringify(s.b_columns || {}),
            extra_scores: JSON.stringify(s.extra_scores || {})
        }));
        return json(res, {
            code: 200, total: students.length, limit: perPage, page,
            data,
            score_subjects: results.getScoreSubjects(students),
            scheduling_mode: config.vba_scheduling_mode,
            w_column_keys: results.getWKeys(students),
            b_column_keys: results.getBKeys(students),
            extra_score_keys: results.getScoreSubjects(students)
        });
    }

    if (action === 'update_student') {
        const students = store.loadStudents(userId);
        const stu = students.find(s => s.id === parseInt(body.fields.student_id, 10));
        if (!stu) return json(res, { code: 404, msg: '学生不存在' });
        const subjects = results.getScoreSubjects(students);

        if (body.fields.preset_class !== undefined) {
            const val = parseInt(body.fields.preset_class, 10) || 0;
            if (val > 0 && (val < 1 || val > store.loadConfig(userId).class_num)) {
                return json(res, { code: 400, msg: `预设班级须在 1~${store.loadConfig(userId).class_num} 之间` });
            }
            if (val > 0) { stu.is_preset = 1; stu.class_id = val; }
            else { stu.is_preset = 0; }
            store.saveStudents(userId, students);
            return json(res, { code: 200, msg: val > 0 ? '已设为预设班级' : '已取消预设' });
        }

        const field = body.fields.field;
        const value = body.fields.value;
        const resp = { code: 200, msg: '已保存' };

        if (field === '_recalc_total') {
            stu.total_score = Number(Object.values(stu.extra_scores || {}).reduce((a, b) => a + b, 0).toFixed(2));
            resp.total_score = stu.total_score;
        } else if (field.startsWith('score_')) {
            const sub = field.substring(6);
            const n = value === '' ? null : Number(value);
            if (!stu.extra_scores) stu.extra_scores = {};
            if (n === null || isNaN(n)) delete stu.extra_scores[sub];
            else stu.extra_scores[sub] = n;
            const curTotal = Number(stu.total_score) || 0;
            const wouldBe = Number(Object.values(stu.extra_scores).reduce((a, b) => a + b, 0).toFixed(2));
            resp.would_be_total = wouldBe;
            resp.total_score = curTotal;
        } else if (field.startsWith('w_')) {
            const k = field.substring(2);
            if (!stu.w_columns) stu.w_columns = {};
            if (value === '') delete stu.w_columns[k]; else stu.w_columns[k] = value;
        } else if (field.startsWith('b_')) {
            const k = field.substring(2);
            if (!stu.b_columns) stu.b_columns = {};
            if (value === '') delete stu.b_columns[k]; else stu.b_columns[k] = value;
        } else if (field === 'bind_group' || field === 'exclude_group') {
            stu[field] = Math.max(0, parseInt(value, 10) || 0);
        } else if (field === 'gender') {
            if (value !== '男' && value !== '女') return json(res, { code: 400, msg: '性别只能为男或女' });
            stu.gender = value;
        } else if (field === 'name') {
            if (!value || value.length < 2 || value.length > 20) return json(res, { code: 400, msg: '姓名长度须为2~20个字符' });
            stu.name = value;
        } else {
            return json(res, { code: 400, msg: '不支持的字段: ' + field });
        }
        store.saveStudents(userId, students);
        return json(res, resp);
    }

    if (action === 'clear_students') {
        store.saveStudents(userId, []);
        store.saveRunState(userId, { status: 'idle', progress: 0, completed_runs: 0, total_runs: 0, best_result: null, band_orders: [] });
        return json(res, { code: 200, msg: '学生数据已清空' });
    }

    if (action === 'clear_results') {
        const students = store.loadStudents(userId);
        for (const s of students) {
            if (s.is_preset !== 1) s.class_id = 0;
        }
        store.saveStudents(userId, students);
        const st = store.loadRunState(userId);
        st.status = 'idle'; st.progress = 0; st.completed_runs = 0; st.band_orders = [];
        store.saveRunState(userId, st);
        return json(res, { code: 200, msg: '分班结果已清空' });
    }

    if (action === 'check_similar_names') {
        const students = store.loadStudents(userId);
        const homophones = results.detectHomophones(students);
        const total = homophones.exact.length + homophones.similar.length;
        return json(res, {
            code: 200, homophones, total_groups: total,
            message: total > 0 ? `发现 ${total} 组读音相近的姓名` : '未发现读音相近的姓名'
        });
    }

    // ── 导入 ──
    if (action === 'import') {
        const f = body.fields || {};
        // 模拟数据生成
        if (f.generate_mock === '1') {
            const mock = results.generateMockStudents(400, 42);
            renumberStudents(mock);
            store.saveStudents(userId, mock);
            const st = store.loadRunState(userId);
            st.status = 'idle'; st.progress = 0; st.completed_runs = 0; st.best_result = null; st.band_orders = [];
            store.saveRunState(userId, st);
            const config = store.loadConfig(userId);
            if (config.vba_scheduling_mode === 'scoreless') {
                config.vba_scheduling_mode = 'standard';
                store.saveConfig(userId, config);
            }
            const homophones = results.detectHomophones(mock);
            return json(res, { code: 200, msg: '已生成 400 条模拟数据（种子 42）', imported: 400, data_count: 400, homophones });
        }

        if (!body.file) return json(res, { code: 400, msg: '请选择文件' });
        const opts = {
            column_map: f.column_map ? JSON.parse(f.column_map) : null,
            preset_column: f.preset_column || null,
            request_column_review: f.request_column_review === '1',
            scoreless_confirm: f.scoreless_confirm === '1',
            confirm_total: f.confirm_total === '1',
            use_imported_total: f.use_imported_total === '1',
            column_review_done: !!(f.column_map || f.preset_column || f.scoreless_confirm || f.confirm_total)
        };
        const parsed = parseWorkbook(body.file.data, opts);
        if (!parsed.ok) {
            const out = { code: 400, msg: parsed.msg || '导入失败' };
            for (const key of ['validation_errors', 'column_review', 'preset_columns_confirm', 'no_scores_detected', 'needs_total_confirm', 'total_mismatches', 'mismatch_count']) {
                if (parsed[key] !== undefined) out[key] = parsed[key];
            }
            return json(res, out);
        }

        // 写入学生数据
        renumberStudents(parsed.students);
        store.saveStudents(userId, parsed.students);
        // 重置分班状态
        const st = store.loadRunState(userId);
        st.status = 'idle'; st.progress = 0; st.completed_runs = 0; st.best_result = null; st.band_orders = [];
        store.saveRunState(userId, st);
        // 模式联动
        const config = store.loadConfig(userId);
        if (parsed.hasScores && config.vba_scheduling_mode === 'scoreless') {
            config.vba_scheduling_mode = 'standard';   // 自动切回标准分班
            store.saveConfig(userId, config);
        } else if (!parsed.hasScores && f.scoreless_confirm === '1') {
            config.vba_scheduling_mode = 'scoreless';
            store.saveConfig(userId, config);
        }
        const homophones = results.detectHomophones(parsed.students);
        return json(res, {
            code: 200,
            msg: `成功导入 ${parsed.students.length} 名学生`,
            imported: parsed.students.length,
            data_count: parsed.students.length,
            homophones
        });
    }

    // ── 配置 ──
    if (action === 'config') {
        const config = store.loadConfig(userId);
        const students = store.loadStudents(userId);
        const f = { ...(body.fields || {}), ...(body.json || {}) };
        const numKeys = ['class_num', 'multi_run_count', 'opt2_time_limit', 'vba_perturb_ratio', 'vba_high_count', 'vba_low_count', 'vba_gender_swap', 'vba_gender_separate_snake', 'vba_constrain_bands', 'vba_combo1', 'vba_combo2', 'use_subject_balance'];
        const strKeys = ['vba_scheduling_mode', 'vba_judgment_mode', 'vba_range_fix_mode', 'vba_band_seed'];
        for (const k of numKeys) {
            if (f[k] !== undefined && f[k] !== null && f[k] !== '') {
                const n = Number(f[k]);
                if (!isNaN(n)) config[k] = n;
            }
        }
        for (const k of strKeys) {
            if (f[k] !== undefined && f[k] !== null) config[k] = String(f[k]);
        }
        if (f.subject_thresholds !== undefined) {
            try {
                const t = typeof f.subject_thresholds === 'string' ? JSON.parse(f.subject_thresholds) : f.subject_thresholds;
                config.subject_thresholds = Array.isArray(t) ? t : [];
            } catch (e) { /* 忽略非法 JSON */ }
        }
        // 校验
        config.class_num = Math.min(50, Math.max(1, Math.round(config.class_num) || 7));
        config.multi_run_count = Math.min(15, Math.max(1, Math.round(config.multi_run_count) || 10));
        if (students.length > 0) {
            const H = Math.max(0, config.vba_high_count || 0), L = Math.max(0, config.vba_low_count || 0);
            if (H + L > students.length) {
                return json(res, { code: 400, msg: `高+低分段总人数(${H + L})超过学生总数(${students.length})` });
            }
        }
        store.saveConfig(userId, config);
        return json(res, { code: 200, msg: '参数已保存' });
    }

    // ── 状态 / 进度 ──
    if (action === 'status') return json(res, statusPayload(user));

    if (action === 'progress') {
        const st = store.loadRunState(userId);
        return json(res, { code: 200, status: st.status, progress: st.progress });
    }

    // ── 分班启动（批次协议：每次调用跑一轮） ──
    if (action === 'start') {
        const force = query.get('force') || '0';
        const students = store.loadStudents(userId);
        if (students.length === 0) return json(res, { code: 400, msg: '没有学生数据，请先导入' });
        const config = store.loadConfig(userId);

        const conflicts = scheduler.detectConflicts(students, config);
        if (conflicts.length) return json(res, { code: 400, msg: '发现约束冲突', conflicts });

        const st = store.loadRunState(userId);
        // 自愈：进程崩溃/被杀会把 status='running' 永久留在磁盘上，导致后续全部 409。
        // 每次批次都是同步完成的，running 超过 5 分钟必为残留状态 → 自动复位（保留进度继续接力）
        if (st.status === 'running') {
            const hb = st.heartbeat || 0;
            if (Date.now() - hb > 5 * 60 * 1000) {
                console.error('[start] 检测到残留 running 状态（心跳 ' + (hb ? new Date(hb).toLocaleString() : '无') + '），自动复位继续');
                st.status = 'idle';
                store.saveRunState(userId, st);
            } else {
                return json(res, { code: 409, msg: '算法正在运行中，请等待完成或刷新页面' });
            }
        }

        // 班级数变更后，历史最优结果（旧班级号的分配）作废，轮次从头开始
        if (st.class_num !== config.class_num) {
            st.class_num = config.class_num;
            st.completed_runs = 0;
            st.best_result = null;
            st.band_orders = [];
        }

        if (force === '1') {
            for (const s of students) {
                s.class_id = s.is_preset === 1 ? s.class_id : 0;
            }
            store.saveStudents(userId, students);
            st.completed_runs = 0;
            st.best_result = null;
            st.band_orders = [];
            config._runSalt = Date.now() % 100000;   // 重新分班时更换随机盐
            store.saveConfig(userId, config);
        }
        if (st.total_runs !== config.multi_run_count) {
            st.completed_runs = 0;
            st.best_result = null;
        }
        st.total_runs = config.multi_run_count;
        st.status = 'running';
        st.heartbeat = Date.now();
        store.saveRunState(userId, st);

        const subjects = results.getScoreSubjects(students);
        const dims = scheduler.buildDims(subjects);
        const runIndex = st.completed_runs;
        let runResult;
        try {
            runResult = scheduler.runOnce(students, config, runIndex, dims, scheduler.mulberry32(1234 + runIndex * 7919 + (config._runSalt || 0)));
        } catch (err) {
            // 算法异常：状态复位并抛出明确错误，绝不让 status 卡死在 running
            console.error('[start] runOnce 异常:', err && err.stack || err);
            st.status = 'error';
            st.progress = 0;
            st.completed_runs = 0;
            st.best_result = null;
            st.band_orders = [];
            store.saveRunState(userId, st);
            return json(res, { code: 500, msg: '分班算法异常：' + (err && err.message || err) });
        }

        // 与历史最优比较
        if (!st.best_result || runResult.cost < st.best_result.cost) {
            const assign = {};
            for (const [stu, cid] of runResult.assignments) assign[stu.id] = cid;
            st.best_result = { cost: runResult.cost, assign };
            st.band_orders = runResult.bandOrders;
        }
        st.completed_runs++;
        st.progress = Math.min(99, Math.round(st.completed_runs / st.total_runs * 99));

        if (st.completed_runs >= st.total_runs) {
            // 完成：写回最优结果
            for (const s of students) {
                if (s.is_preset === 1) continue;
                s.class_id = st.best_result.assign[s.id] || 0;
            }
            store.saveStudents(userId, students);
            st.status = 'done';
            st.progress = 100;
            store.saveRunState(userId, st);
            return json(res, { code: 200, status: 'done', progress: 100 });
        }
        store.saveRunState(userId, st);
        // 批次间回到 idle，允许下一次 start 接力（进度/轮次保留）
        st.status = 'idle';
        store.saveRunState(userId, st);
        return json(res, {
            code: 200, partial: true,
            progress: st.progress,
            completed_runs: st.completed_runs,
            total_runs: st.total_runs
        });
    }

    // ── 结果 ──
    if (action === 'result') {
        const students = store.loadStudents(userId);
        const config = store.loadConfig(userId);
        const st = store.loadRunState(userId);
        const result = results.buildResult(students, config, st.band_orders);
        return json(res, result);
    }

    // ── 手动移动 ──
    if (action === 'move') {
        const students = store.loadStudents(userId);
        const stu = students.find(s => s.id === parseInt(body.fields.student_id, 10));
        if (!stu) return json(res, { code: 404, msg: '学生不存在' });
        const target = parseInt(body.fields.target_class_id, 10);
        if (!(target >= 1)) return json(res, { code: 400, msg: '目标班级无效' });
        const config = store.loadConfig(userId);
        if (target > config.class_num) return json(res, { code: 400, msg: `目标班级超出范围（1~${config.class_num}）` });
        if (stu.is_preset === 1) return json(res, { code: 400, msg: `${stu.name} 已预设到第 ${stu.class_id} 班，不可移动` });

        // 绑定组整组移动
        const group = stu.bind_group > 0 ? students.filter(s => s.bind_group === stu.bind_group) : [stu];
        // 互斥检查
        for (const m of group) {
            if (m.exclude_group > 0) {
                const conflict = students.find(s => s.exclude_group === m.exclude_group && s.class_id === target && !group.includes(s));
                if (conflict) return json(res, { code: 400, msg: `互斥冲突：${m.name} 与 ${conflict.name}（互斥组 ${m.exclude_group}）不能同班` });
            }
        }
        for (const m of group) m.class_id = target;
        store.saveStudents(userId, students);
        return json(res, { code: 200, msg: 'ok', moved_count: group.length });
    }

    // ── 反馈 ──
    if (action === 'feedback_submit') {
        const content = (body.fields.content || '').trim();
        if (!content) return json(res, { code: 400, msg: '请输入留言内容' });
        if (content.length > 2000) return json(res, { code: 400, msg: '留言不能超过 2000 字' });
        const list = store.loadFeedback();
        list.unshift({
            id: list.reduce((m, x) => Math.max(m, x.id), 0) + 1,
            user_id: userId, author_name: user.display_name || user.username,
            content, created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
            reply: null, replied_at: null
        });
        store.saveFeedback(list);
        return json(res, { code: 200, msg: '留言已提交' });
    }
    if (action === 'feedback_list') {
        const isAdmin = user.is_admin == 1;
        let items = store.loadFeedback();
        if (!isAdmin) items = items.filter(x => x.user_id === userId);
        return json(res, { code: 200, is_admin: isAdmin, items });
    }
    if (action === 'feedback_reply' || action === 'feedback_delete') {
        if (user.is_admin != 1) return json(res, { code: 403, msg: '仅管理员可操作' });
        const list = store.loadFeedback();
        const id = parseInt(body.fields.feedback_id, 10);
        const item = list.find(x => x.id === id);
        if (!item) return json(res, { code: 404, msg: '留言不存在' });
        if (action === 'feedback_reply') {
            const reply = (body.fields.reply || '').trim();
            if (!reply) return json(res, { code: 400, msg: '请输入回复内容' });
            item.reply = reply;
            item.replied_at = new Date().toISOString().replace('T', ' ').substring(0, 19);
        } else {
            list.splice(list.indexOf(item), 1);
        }
        store.saveFeedback(list);
        return json(res, { code: 200, msg: 'ok' });
    }

    // ── 密码 ──
    if (action === 'change_self_password') {
        const oldPwd = body.fields.old_password || '';
        const newPwd = body.fields.new_password || '';
        if (!store.verifyPassword(oldPwd, user.password)) return json(res, { code: 400, msg: '当前密码错误' });
        if (newPwd.length < 6) return json(res, { code: 400, msg: '新密码至少需要 6 个字符' });
        store.updateUser(userId, { password: store.hashPassword(newPwd) });
        return json(res, { code: 200, msg: '密码修改成功' });
    }

    // ── 管理员 ──
    if (action === 'admin_list_users') {
        if (user.is_admin != 1) return json(res, { code: 403, msg: '仅管理员可操作' });
        const users = store.loadUsers().map(u => ({
            id: u.id, username: u.username, display_name: u.display_name,
            is_admin: u.is_admin, is_disabled: u.is_disabled,
            student_count: store.loadStudents(u.id).length,
            created_at: u.created_at, vba_authorized_modes: u.vba_authorized_modes || ''
        }));
        return json(res, { code: 200, users });
    }
    if (action === 'admin_toggle_user') {
        if (user.is_admin != 1) return json(res, { code: 403, msg: '仅管理员可操作' });
        const target = store.getUserById(parseInt(body.fields.user_id, 10));
        if (!target) return json(res, { code: 404, msg: '用户不存在' });
        if (target.id === user.id) return json(res, { code: 400, msg: '不能禁用自己' });
        store.updateUser(target.id, { is_disabled: target.is_disabled == 1 ? 0 : 1 });
        return json(res, { code: 200, msg: target.is_disabled == 1 ? '已启用' : '已禁用' });
    }
    if (action === 'admin_delete_user') {
        if (user.is_admin != 1) return json(res, { code: 403, msg: '仅管理员可操作' });
        const target = store.getUserById(parseInt(body.fields.user_id, 10));
        if (!target) return json(res, { code: 404, msg: '用户不存在' });
        if (target.id === user.id) return json(res, { code: 400, msg: '不能删除自己' });
        store.deleteUser(target.id);
        return json(res, { code: 200, msg: '用户已删除' });
    }
    if (action === 'admin_change_password') {
        if (user.is_admin != 1) return json(res, { code: 403, msg: '仅管理员可操作' });
        const newPwd = body.fields.new_password || '';
        if (newPwd.length < 6) return json(res, { code: 400, msg: '密码至少需要 6 个字符' });
        store.updateUser(parseInt(body.fields.user_id, 10), { password: store.hashPassword(newPwd) });
        return json(res, { code: 200, msg: '密码已修改' });
    }
    if (action === 'admin_authorize_modes') {
        if (user.is_admin != 1) return json(res, { code: 403, msg: '仅管理员可操作' });
        const target = store.getUserById(parseInt(body.fields.user_id, 10));
        if (!target) return json(res, { code: 404, msg: '用户不存在' });
        const modes = [];
        if (body.fields.balanced === '1') modes.push('balanced');
        if (body.fields.precision === '1') modes.push('precision');
        store.updateUser(target.id, { vba_authorized_modes: modes.join(',') });
        return json(res, { code: 200, msg: '授权已更新' });
    }

    // ── 导出 ──
    if (action === 'export_roster') {
        const students = store.loadStudents(userId);
        const payload = body.json || {};
        const buf = exporter.buildRosterWorkbook(students, payload);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="roster.xlsx"',
            'Cache-Control': 'no-store'
        });
        return res.end(buf);
    }
    if (action === 'export_results') {
        const students = store.loadStudents(userId);
        const config = store.loadConfig(userId);
        const st = store.loadRunState(userId);
        const result = results.buildResult(students, config, st.band_orders);
        const buf = exporter.buildResultsWorkbook(students, config, result);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="results.xlsx"',
            'Cache-Control': 'no-store'
        });
        return res.end(buf);
    }

    return json(res, { code: 404, msg: '未知操作: ' + action }, 404);
}

// ── 认证接口（登录/注册/登出，无需 CSRF） ──
function handleAuth(req, res, action, body, query) {
    const f = body.fields || {};
    if (action === 'login') {
        const username = (f.username || '').trim();
        const password = f.password || '';
        const user = store.getUserByUsername(username);
        if (!user || !store.verifyPassword(password, user.password)) {
            return json(res, { code: 400, msg: '用户名或密码错误' });
        }
        if (user.is_disabled == 1) return json(res, { code: 403, msg: '账号已被禁用' });
        const sid = store.createSession(user.id);
        const sess = store.getSession(sid);
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
        return json(res, { code: 200, msg: '登录成功', csrf_token: sess.csrf });
    }
    if (action === 'register') {
        const username = (f.username || '').trim();
        const password = f.password || '';
        const displayName = (f.display_name || '').trim();
        if (!username || username.length < 3 || username.length > 30) return json(res, { code: 400, msg: '用户名须为 3~30 个字符' });
        if (!password || password.length < 6) return json(res, { code: 400, msg: '密码至少需要 6 个字符' });
        if (store.getUserByUsername(username)) return json(res, { code: 400, msg: '用户名已存在' });
        const user = store.createUser(username, password, displayName || username);
        const sid = store.createSession(user.id);
        const sess = store.getSession(sid);
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
        return json(res, { code: 200, msg: '注册成功', csrf_token: sess.csrf });
    }
    if (action === 'logout') {
        const cookies = parseCookies(req);
        if (cookies[COOKIE_NAME]) store.destroySession(cookies[COOKIE_NAME]);
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0`);
        return json(res, { code: 200, msg: '已退出' });
    }
    return json(res, { code: 404, msg: '未知操作' }, 404);
}

// ── 静态文件 ──
const MIME = {
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
function serveStatic(res, filePath) {
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
}

// ══════════════════ HTTP 服务 ══════════════════
const server = http.createServer(async (req, res) => {
    try {
        const u = new URL(req.url, 'http://localhost');
        let pathname = decodeURIComponent(u.pathname);
        // 兼容 /FB/ 或 /index.php 前缀
        pathname = pathname.replace(/^\/(FB|index\.php)/, '') || '/';
        if (pathname === '') pathname = '/';
        const action = u.searchParams.get('action') || '';

        // 静态资源
        if (req.method === 'GET' && pathname.startsWith('/assets/')) {
            const fp = path.join(PUBLIC_DIR, pathname);
            if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
            return serveStatic(res, fp);
        }
        if (req.method === 'GET' && (pathname === '/favicon.ico')) {
            res.writeHead(204); res.end(); return;
        }

        // 首页
        if (req.method === 'GET' && (pathname === '/' || pathname === '/index.php') && !action) {
            const auth = getSessionUser(req);
            if (auth) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                return res.end(renderApp(auth.user, auth.sess));
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(loginHtml);
        }

        // API / 认证（action 可在 query 或 POST body 中）
        let act = action;
        let body = null;
        if (req.method === 'POST') {
            body = await parseBody(req);
            if (!act && body.fields) act = body.fields.action || '';
            if (!act && body.json) act = body.json.action || '';
        }
        if (act) {
            const AUTH_ACTIONS = ['login', 'register', 'logout'];
            if (AUTH_ACTIONS.includes(act)) {
                return handleAuth(req, res, act, body || { fields: {} }, u.searchParams);
            }

            const auth = getSessionUser(req);
            if (!auth) {
                return json(res, { code: 401, msg: '未登录或会话已过期' }, 401);
            }
            return await handleApi(req, res, act, body || { fields: {} }, u.searchParams, auth);
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
    } catch (err) {
        console.error('[server]', err);
        try { json(res, { code: 500, msg: '服务器内部错误: ' + err.message }, 500); } catch (e) {}
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('==============================================');
    console.log('  中小学智能分班管理系统 · 离线版');
    console.log(`  已启动: http://localhost:${PORT}`);
    console.log('  数据目录: ' + store.DATA_DIR);
    console.log('  按 Ctrl+C 停止服务');
    console.log('==============================================');
});
