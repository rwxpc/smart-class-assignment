/**
 * results.js — 结果统计、模拟数据生成、同音名检测
 */
'use strict';
const store = require('./store');
const { mulberry32 } = require('./scheduler');

/**
 * 计算分班结果（从学生 class_id 实时统计）
 * @returns 与前端 loadResults 对齐的完整结果对象
 */
function buildResult(students, config, bandOrders) {
    const classNum = config.class_num;
    const assigned = students.filter(s => s.class_id > 0);
    const subjects = getScoreSubjects(students);
    const scoreless = config.vba_scheduling_mode === 'scoreless';

    const classes = [];
    for (let c = 1; c <= classNum; c++) {
        const list = assigned.filter(s => s.class_id === c);
        const male = list.filter(s => s.gender === '男').length;
        const female = list.length - male;
        const avg = list.length ? list.reduce((s, x) => s + (Number(x.total_score) || 0), 0) / list.length : 0;
        const subject_avgs = {};
        for (const sub of subjects) {
            const withScore = list.filter(s => s.extra_scores && s.extra_scores[sub] !== undefined);
            subject_avgs[sub] = withScore.length ? Number((withScore.reduce((s, x) => s + x.extra_scores[sub], 0) / withScore.length).toFixed(2)) : '-';
        }
        classes.push({
            class_id: c,
            class_name: c + '班',
            count: list.length,
            avg_score: Number(avg.toFixed(2)),
            male_count: male,
            female_count: female,
            subject_avgs,
            students: list.slice().sort((a, b) => (b.total_score - a.total_score)).map(s => ({
                id: s.id, name: s.name, gender: s.gender,
                total_score: Number(s.total_score) || 0,
                label: s.label || '', class_id: s.class_id
            }))
        });
    }

    const overallAvg = assigned.length ? assigned.reduce((s, x) => s + (Number(x.total_score) || 0), 0) / assigned.length : 0;

    // ── 段分布与 all_sorted ──
    const sortedDesc = assigned.slice().sort((a, b) => (Number(b.total_score) || 0) - (Number(a.total_score) || 0));
    const cn = classNum;
    const totalBands = Math.ceil(sortedDesc.length / cn) || 1;
    let highBands = Math.floor(Math.max(0, Math.round((config.vba_high_count || 0) / cn) * cn) / cn);
    let lowBands = Math.floor(Math.max(0, Math.round((config.vba_low_count || 0) / cn) * cn) / cn);
    highBands = Math.min(highBands, totalBands);
    lowBands = Math.min(lowBands, totalBands - highBands);

    const all_sorted = [];
    const bandTableTop = [];
    const bandTableBottom = [];
    const band_orders = [];

    if (sortedDesc.length > 0) {
    for (let b = 0; b < totalBands; b++) {
        const band = sortedDesc.slice(b * cn, (b + 1) * cn);
        const segment = b < highBands ? '高' : (b >= totalBands - lowBands ? '低' : '中');
        band.forEach((s, pos) => {
            all_sorted.push({
                rank: b * cn + pos + 1,
                name: s.name, gender: s.gender,
                total_score: Number(s.total_score) || 0,
                class_id: s.class_id,
                band: b, pos_in_band: pos,
                segment, is_preset: s.is_preset === 1 ? 1 : 0
            });
        });
        band_orders.push((bandOrders && bandOrders[b]) || Array.from({ length: cn }, (_, i) => i + 1));

        // 表二A：前X名累计（每个段都输出累计列：前cn名、前2cn名……直到全部）
        {
            const topCount = Math.min((b + 1) * cn, sortedDesc.length);
            const upto = sortedDesc.slice(0, topCount);
            const row = { label: '前' + topCount + '名', classes: [], male_classes: [], female_classes: [] };
            for (let c = 1; c <= cn; c++) {
                const inClass = upto.filter(s => s.class_id === c);
                row.classes.push(inClass.length);
                row.male_classes.push(inClass.filter(s => s.gender === '男').length);
                row.female_classes.push(inClass.filter(s => s.gender === '女').length);
            }
            row.range = Math.max(...row.classes) - Math.min(...row.classes);
            bandTableTop.push(row);
        }
        // 表二B：后X名累计（每个段都输出累计列：后cn名、后2cn名……直到全部）
        {
            const bottomCount = Math.min((b + 1) * cn, sortedDesc.length);
            const bottom = sortedDesc.slice(sortedDesc.length - bottomCount);
            const row = { label: '后' + bottomCount + '名', classes: [], male_classes: [], female_classes: [] };
            for (let c = 1; c <= cn; c++) {
                const inClass = bottom.filter(s => s.class_id === c);
                row.classes.push(inClass.length);
                row.male_classes.push(inClass.filter(s => s.gender === '男').length);
                row.female_classes.push(inClass.filter(s => s.gender === '女').length);
            }
            row.range = Math.max(...row.classes) - Math.min(...row.classes);
            bandTableBottom.push(row);
        }
    }
    }

    // ── 学科优秀生分布 ──
    const subject_distribution = [];
    if (!scoreless && config.use_subject_balance == 1) {
        const thresholds = typeof config.subject_thresholds === 'string' ? JSON.parse(config.subject_thresholds || '[]') : (config.subject_thresholds || []);
        for (const t of thresholds) {
            if (!t.threshold || t.threshold <= 0) continue;
            const qualified = assigned.filter(s => s.extra_scores && s.extra_scores[t.name] !== undefined && s.extra_scores[t.name] >= t.threshold);
            const class_counts = [];
            for (let c = 1; c <= cn; c++) class_counts.push(qualified.filter(s => s.class_id === c).length);
            subject_distribution.push({
                name: t.name, threshold: t.threshold, class_counts,
                total: qualified.length,
                range: Math.max(...class_counts) - Math.min(...class_counts)
            });
        }
    }

    // ── W 列分布 ──
    const wKeys = getWKeys(students);
    const w_distributions = [];
    for (const wk of wKeys) {
        const valueSet = new Set();
        assigned.forEach(s => { const v = s.w_columns && s.w_columns[wk]; if (v) valueSet.add(v); });
        const values = Array.from(valueSet).sort();
        if (!values.length) continue;
        const class_counts = {};
        for (const v of values) {
            class_counts[v] = [];
            for (let c = 1; c <= cn; c++) {
                class_counts[v].push(assigned.filter(s => s.class_id === c && s.w_columns && s.w_columns[wk] === v).length);
            }
        }
        w_distributions.push({ key: wk, values, class_counts });
    }

    return {
        code: 200,
        scheduling_mode: config.vba_scheduling_mode,
        class_num: cn,
        total_students: assigned.length,
        overall_avg: Number(overallAvg.toFixed(2)),
        classes,
        score_subjects: subjects,
        extra_score_keys: subjects,
        band_table_top: bandTableTop,
        band_table_bottom: bandTableBottom,
        all_sorted,
        band_orders,
        subject_distribution,
        w_distributions,
        vba_band_seed: config.vba_band_seed || '',
        high_bands: highBands,
        low_bands: lowBands,
        total_bands: totalBands
    };
}

function getScoreSubjects(students) {
    const set = new Set();
    for (const s of students) {
        if (s.extra_scores) for (const k of Object.keys(s.extra_scores)) set.add(k);
    }
    return Array.from(set);
}
function getWKeys(students) {
    const set = new Set();
    for (const s of students) {
        if (s.w_columns) for (const k of Object.keys(s.w_columns)) set.add(k);
    }
    return Array.from(set);
}
function getBKeys(students) {
    const set = new Set();
    for (const s of students) {
        if (s.b_columns) for (const k of Object.keys(s.b_columns)) set.add(k);
    }
    return Array.from(set);
}

// ── 模拟数据生成（400 人，种子 42 可复现） ──
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const GIVEN_M = '伟强军磊洪博文涛宇浩然明杰俊杰志远天翔建华国栋思聪子轩浩宇铭泽晓峰嘉懿煜城昊天一鸣俊驰雨泽烨磊晟睿文昊修杰黎昕远航旭尧翰思郎烨伟宸逸轩泽洋瑞霖';
const GIVEN_F = '芳娟敏静丽娜雪梅琳晶欣怡佳琦雨婷梦洁雅静晓萱怡香紫莺依凝佳音月婵慧妍婧琪凌薇美琳诗琪书瑶乐萱玥怡珂玥馨怡沛玲思颖雪慧梓涵语嫣若曦静姝婉婷悦宁';
const LABELS = ['特长生', '学区生', '借读', '随迁子女', '教师子女'];

function generateMockStudents(count, seed) {
    const rnd = mulberry32(seed || 42);
    const students = [];
    const bindGroups = {};
    const exclGroups = {};
    for (let i = 0; i < count; i++) {
        const surname = SURNAMES[Math.floor(rnd() * SURNAMES.length)];
        const isMale = rnd() < 0.52;
        const pool = isMale ? GIVEN_M : GIVEN_F;
        const nameLen = rnd() < 0.7 ? 2 : 1;
        let given = '';
        for (let j = 0; j < nameLen; j++) given += pool[Math.floor(rnd() * pool.length)];
        const ability = 45 + rnd() * 50; // 45~95
        const s = {
            name: surname + given,
            gender: isMale ? '男' : '女',
            extra_scores: {},
            w_columns: {},
            b_columns: {},
            bind_group: 0, exclude_group: 0,
            is_preset: 0, class_id: 0,
            total_score: 0, label: '', is_boarding: 0
        };
        for (const sub of ['语文', '数学', '英语']) {
            const score = Math.round(Math.max(20, Math.min(100, ability + (rnd() - 0.5) * 24)));
            s.extra_scores[sub] = score;
        }
        s.total_score = Object.values(s.extra_scores).reduce((a, b) => a + b, 0);
        if (rnd() < 0.5) s.w_columns['住校'] = rnd() < 0.4 ? '是' : '否';
        if (rnd() < 0.3) s.w_columns['学区'] = rnd() < 0.5 ? '学区内' : '学区外';
        if (rnd() < 0.12) s.label = LABELS[Math.floor(rnd() * LABELS.length)];
        if (s.label) s.b_columns['备注'] = s.label;
        students.push(s);
    }
    // 绑定组：15 组双胞胎
    for (let g = 1; g <= 15; g++) {
        const i1 = Math.floor(rnd() * count);
        let i2 = Math.floor(rnd() * count);
        if (i2 === i1) i2 = (i2 + 1) % count;
        if (students[i1].bind_group === 0 && students[i2].bind_group === 0) {
            students[i1].bind_group = g; students[i2].bind_group = g;
        }
    }
    // 互斥组：15 组
    for (let g = 1; g <= 15; g++) {
        const i1 = Math.floor(rnd() * count);
        let i2 = Math.floor(rnd() * count);
        if (i2 === i1) i2 = (i2 + 2) % count;
        if (students[i1].exclude_group === 0 && students[i2].exclude_group === 0) {
            students[i1].exclude_group = g; students[i2].exclude_group = g;
        }
    }
    return students;
}

// ── 同音名检测 ──
function detectHomophones(students) {
    let pinyinOf;
    try {
        const { pinyin } = require('pinyin-pro');
        pinyinOf = name => pinyin(name, { toneType: 'none', type: 'array' });
    } catch (e) {
        pinyinOf = null;
    }
    const exact = [];
    const similar = [];
    if (!pinyinOf || students.length === 0) return { exact, similar };

    // 精确同音：拼音串相同
    const pyMap = new Map();
    for (const s of students) {
        const py = pinyinOf(s.name).join('');
        if (!pyMap.has(py)) pyMap.set(py, []);
        pyMap.get(py).push(s.name);
    }
    const uniqueNames = new Set(students.map(s => s.name));
    for (const [py, names] of pyMap) {
        const uniq = Array.from(new Set(names));
        if (uniq.length > 1) exact.push({ pinyin: py, members: uniq.map(n => ({ name: n })) });
    }

    // 读音相近：N-1 个字拼音相同（限制规模避免卡顿）
    if (uniqueNames.size <= 3000) {
        const nameList = Array.from(uniqueNames).filter(n => !exact.some(g => g.members.some(m => m.name === n)));
        const pyList = nameList.map(n => pinyinOf(n));
        const grouped = new Set();
        for (let i = 0; i < nameList.length; i++) {
            if (grouped.has(nameList[i])) continue;
            for (let j = i + 1; j < nameList.length; j++) {
                if (grouped.has(nameList[j])) continue;
                const a = pyList[i], b = pyList[j];
                if (a.length !== b.length) continue;
                let diff = 0, diffPos = -1;
                for (let k = 0; k < a.length; k++) {
                    if (a[k] !== b[k]) { diff++; diffPos = k; if (diff > 1) break; }
                }
                if (diff === 1) {
                    const merged = (grouped.has(nameList[i]) ? similar.find(g => g.members.some(m => m.name === nameList[i])) : null);
                    if (merged) {
                        merged.members.push({ name: nameList[j] });
                    } else {
                        const pinyins = a.slice(); pinyins[diffPos] = a[diffPos] + '/' + b[diffPos];
                        similar.push({ pinyins, members: [{ name: nameList[i] }, { name: nameList[j] }] });
                    }
                    grouped.add(nameList[i]); grouped.add(nameList[j]);
                    break;
                }
            }
        }
    }
    return { exact, similar };
}

module.exports = { buildResult, getScoreSubjects, getWKeys, getBKeys, generateMockStudents, detectHomophones };
