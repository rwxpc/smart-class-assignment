/**
 * scheduler.js — 分班算法引擎（逆向还原）
 *
 * 多轮独立运行：每轮 = 蛇形初始化（高/低分段硬约束保护）+ 2-opt 全局交换优化，
 * 取代价最优的一轮作为最终结果。2-opt 使用增量求值保证性能。
 *
 * 代价函数：
 *  - 标准版：Σ(各班各维度均值 - 全校均值)²  （维度 = 各学科 + 总分 + W 分类均衡）
 *  - BZB 版：基础代价 × (各段极差总和/100)^10 —— 段不均衡的方案指数级劣化
 *  - 无成绩版：性别 + W 分类人数偏离²
 */
'use strict';

// ── 可复现随机数 ──
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffleArr(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function parseBandSeed(seedStr, classNum) {
    if (!seedStr) return null;
    const parts = seedStr.split(/[,，\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
    if (parts.length !== classNum) return null;
    const set = new Set(parts);
    for (let i = 1; i <= classNum; i++) if (!set.has(i)) return null;
    return parts;
}

// ── 原子构建：绑定组作为整体、预设班级锁定 ──
function buildAtoms(students, classNum) {
    const bindMap = new Map();
    const atoms = [];
    for (const s of students) {
        if (s.bind_group > 0) {
            if (!bindMap.has(s.bind_group)) {
                const atom = { members: [], locked: false, fixedClass: 0, classId: 0 };
                bindMap.set(s.bind_group, atom);
                atoms.push(atom);
            }
            bindMap.get(s.bind_group).members.push(s);
        } else {
            atoms.push({ members: [s], locked: false, fixedClass: 0, classId: 0 });
        }
    }
    const finalAtoms = [];
    for (const a of atoms) {
        const presetMembers = a.members.filter(s => s.is_preset === 1);
        if (a.members.length > 1 && presetMembers.length > 0) {
            const pcs = new Set(presetMembers.map(s => s.class_id));
            if (presetMembers.length < a.members.length || pcs.size > 1) {
                // 部分预设或预设冲突 → 拆成单人原子
                for (const s of a.members) {
                    finalAtoms.push({ members: [s], locked: s.is_preset === 1, fixedClass: s.is_preset === 1 ? s.class_id : 0, classId: 0 });
                }
                continue;
            }
        }
        if (presetMembers.length === a.members.length && a.members.length > 0) {
            a.locked = true;
            a.fixedClass = presetMembers[0].class_id;
        }
        finalAtoms.push(a);
    }
    return finalAtoms;
}

function atomTotal(a) { return a.members.reduce((s, m) => s + (Number(m.total_score) || 0), 0); }
function atomGender(a) {
    const m0 = a.members[0].gender;
    return a.members.every(m => m.gender === m0) ? m0 : 'mix';
}

/** 原子的聚合特征（用于增量代价计算） */
function atomAgg(a, dims) {
    const agg = { n: a.members.length, dims: new Array(dims.length).fill(0), wCounts: {}, male: 0, female: 0 };
    for (const m of a.members) {
        dims.forEach((d, di) => { agg.dims[di] += d.get(m); });
        if (m.gender === '男') agg.male++; else if (m.gender === '女') agg.female++;
        if (m.w_columns) {
            for (const [k, v] of Object.entries(m.w_columns)) {
                const key = k + '\u0001' + v;
                agg.wCounts[key] = (agg.wCounts[key] || 0) + 1;
            }
        }
    }
    return agg;
}

// ── 分班前约束冲突检测 ──
function detectConflicts(students, config) {
    const conflicts = [];
    const classNum = config.class_num;
    for (const s of students) {
        if (s.is_preset === 1 && (s.class_id < 1 || s.class_id > classNum)) {
            conflicts.push({ msg: `${s.name} 的预设班级(${s.class_id})超出班级数范围(1~${classNum})` });
        }
    }
    const presetCount = {};
    for (const s of students) if (s.is_preset === 1) presetCount[s.class_id] = (presetCount[s.class_id] || 0) + 1;
    const cap = Math.ceil(students.length / classNum) + 2;
    for (const [cid, n] of Object.entries(presetCount)) {
        if (n > cap) conflicts.push({ msg: `预设到第 ${cid} 班的学生过多（${n} 人），超出班级容量（约 ${cap} 人）` });
    }
    const exclCount = {};
    for (const s of students) if (s.exclude_group > 0) exclCount[s.exclude_group] = (exclCount[s.exclude_group] || 0) + 1;
    for (const [g, n] of Object.entries(exclCount)) {
        if (n > classNum) conflicts.push({ msg: `互斥组 ${g} 有 ${n} 名学生，超过班级数 ${classNum}，无法满足互斥约束` });
    }
    return conflicts;
}

function quickExcludeCheck(atoms) {
    const map = new Map();
    for (const a of atoms) {
        for (const m of a.members) {
            if (m.exclude_group > 0) {
                if (!map.has(m.exclude_group)) map.set(m.exclude_group, new Set());
                const set = map.get(m.exclude_group);
                if (set.has(a.classId)) return false;
                set.add(a.classId);
            }
        }
    }
    return true;
}

/**
 * 局部互斥检查：交换 A/B 后，仅检查 A、B 成员所在互斥组在两个班级内是否冲突
 * 调用时 A.classId / B.classId 已完成交换
 * 判定标准：交换后任一受影响班级内，同一互斥组的成员数 ≥2 即冲突
 * （正确处理"违规原子换出、同组伙伴留在原班"的修复场景）
 */
function excludeOkForSwap(atoms, A, B) {
    const groups = new Set();
    for (const m of A.members) if (m.exclude_group > 0) groups.add(m.exclude_group);
    for (const m of B.members) if (m.exclude_group > 0) groups.add(m.exclude_group);
    if (!groups.size) return true;
    const ca = A.classId, cb = B.classId;
    for (const target of [ca, cb]) {
        const counts = new Map();
        for (const X of atoms) {
            if (X.classId !== target) continue;
            for (const m of X.members) {
                if (m.exclude_group > 0 && groups.has(m.exclude_group)) {
                    const c = (counts.get(m.exclude_group) || 0) + 1;
                    if (c > 1) return false;
                    counts.set(m.exclude_group, c);
                }
            }
        }
    }
    return true;
}

/** 找到一个违反互斥约束的原子 */
function findViolatingAtom(atoms) {
    const seen = new Map(); // group -> classId
    for (const a of atoms) {
        for (const m of a.members) {
            if (m.exclude_group > 0) {
                if (seen.has(m.exclude_group)) return a;
                seen.set(m.exclude_group, a.classId);
            }
        }
    }
    return null;
}

/** 统计互斥冲突组数（调试用）。冲突 = 组内出现同班成员（组员必须分在不同班） */
function countViol(atoms) {
    const map = new Map(); // group -> { total, classes:Set }
    for (const a of atoms) {
        for (const m of a.members) {
            if (m.exclude_group > 0) {
                if (!map.has(m.exclude_group)) map.set(m.exclude_group, { total: 0, classes: new Set() });
                const rec = map.get(m.exclude_group);
                rec.total++;
                rec.classes.add(a.classId);
            }
        }
    }
    let n = 0;
    for (const [, rec] of map) if (rec.classes.size < rec.total) n++;
    return n;
}

const dbg0 = () => process.env.DEBUG_2OPT;

/** 修复现有互斥冲突：按冲突组逐个修复，将可移动的违规原子换到无冲突班级 */
function repairExcludes(atoms, movable, rnd) {
    for (let guard = 0; guard < 300; guard++) {
        if (quickExcludeCheck(atoms)) return;
        // 按互斥组归类
        const byGroup = new Map();
        for (const a of atoms) {
            for (const m of a.members) {
                if (m.exclude_group > 0) {
                    if (!byGroup.has(m.exclude_group)) byGroup.set(m.exclude_group, []);
                    byGroup.get(m.exclude_group).push(a);
                }
            }
        }
        let repaired = false;
        for (const [, list] of byGroup) {
            // 冲突 = 组内出现同班成员（组员必须分在不同班）
            const distinct = new Set(list.map(a => a.classId));
            if (distinct.size >= list.length) continue;   // 该组无冲突
            const bad = list.find(a => !a.locked);        // 选一个可移动的成员
            if (!bad) continue;                       // 全部锁定（如预设班级），无法修复
            const candidates = shuffleArr(movable.filter(a => a !== bad && !a.locked), rnd);
            for (const B of candidates) {
                const t = bad.classId; bad.classId = B.classId; B.classId = t;
                if (excludeOkForSwap(atoms, bad, B)) { repaired = true; break; }
                const r = bad.classId; bad.classId = B.classId; B.classId = r;
            }
            if (repaired) break;   // 修复一个后重新扫描
        }
        if (!repaired) break;      // 无法继续修复，保留现状
    }
}

// ── 代价评估上下文 ──
function makeCtx(atoms, classNum, config, dims, scoreless) {
    const ctx = { classNum, dims, scoreless, bzb: (!scoreless && config.vba_judgment_mode === 'bzb'), classAgg: [] };
    for (let c = 0; c <= classNum; c++) {
        ctx.classAgg.push({ n: 0, dims: new Array(dims.length).fill(0), wCounts: {}, male: 0, female: 0 });
    }
    for (const a of atoms) {
        if (a.classId < 1 || a.classId > classNum) continue;
        const agg = atomAgg(a, dims);
        addTo(ctx.classAgg[a.classId], agg);
    }
    // 全局统计
    const total = { n: 0, dims: new Array(dims.length).fill(0), wCounts: {}, male: 0, female: 0 };
    for (const a of atoms) addTo(total, atomAgg(a, dims));
    ctx.globals = dims.map((d, di) => total.n ? total.dims[di] / total.n : 0);
    ctx.idealW = {};
    for (const key of Object.keys(total.wCounts)) ctx.idealW[key] = total.wCounts[key] / classNum;
    ctx.totalN = total.n;
    // BZB 段结构：按总分排序的原子分段
    ctx.bandAtoms = null;
    return ctx;
}
function addTo(agg, a) {
    agg.n += a.n;
    for (let i = 0; i < agg.dims.length; i++) agg.dims[i] += a.dims[i];
    for (const [k, v] of Object.entries(a.wCounts)) agg.wCounts[k] = (agg.wCounts[k] || 0) + v;
    agg.male += a.male; agg.female += a.female;
}
function subFrom(agg, a) {
    agg.n -= a.n;
    for (let i = 0; i < agg.dims.length; i++) agg.dims[i] -= a.dims[i];
    for (const [k, v] of Object.entries(a.wCounts)) agg.wCounts[k] = (agg.wCounts[k] || 0) - v;
    agg.male -= a.male; agg.female -= a.female;
}

/** 单班代价贡献 */
function classCost(ctx, agg) {
    if (agg.n === 0) return 1e6;
    let cost = 0;
    // 人数均衡（硬性要求：各班人数差≤1）。原子大小不同（绑定组），成对交换会改变班级人数，
    // 必须把人数偏离计入代价，否则优化器会用人数换分数。
    const devN = agg.n - ctx.totalN / ctx.classNum;
    cost += devN * devN * 2;
    if (!ctx.scoreless) {
        for (let di = 0; di < ctx.dims.length; di++) {
            const dev = agg.dims[di] / agg.n - ctx.globals[di];
            cost += dev * dev;
        }
    }
    for (const [key, ideal] of Object.entries(ctx.idealW)) {
        const dev = (agg.wCounts[key] || 0) - ideal;
        cost += dev * dev * 0.5;
    }
    if (ctx.scoreless) {
        const devG = agg.male - agg.female;
        cost += devG * devG * 2;
    } else {
        // 标准模式也纳入性别均衡（较小权重，避免蛇形残留失衡）
        const devG = agg.male - agg.female;
        cost += devG * devG * 0.3;
    }
    return cost;
}

/** BZB 段极差因子 */
function bzbFactor(ctx, atoms) {
    if (!ctx.bzb) return 1;
    const sorted = atoms.slice().sort((a, b) => atomTotal(b) - atomTotal(a));
    const cn = ctx.classNum;
    let rangeSum = 0;
    for (let i = 0; i + cn <= sorted.length; i += cn) {
        const band = sorted.slice(i, i + cn);
        const totals = {};
        for (const a of band) totals[a.classId] = (totals[a.classId] || 0) + atomTotal(a) / a.members.length;
        const vals = Object.values(totals);
        if (vals.length > 1) rangeSum += Math.max(...vals) - Math.min(...vals);
    }
    return Math.pow(rangeSum / 100 + 1e-6, 10);
}

function totalCost(ctx, atoms) {
    let base = 0;
    for (let c = 1; c <= ctx.classNum; c++) base += classCost(ctx, ctx.classAgg[c]);
    return base * bzbFactor(ctx, atoms);
}

// ── 蛇形初始化 ──
function snakeInit(atoms, movable, config, runIndex, rnd) {
    const classNum = config.class_num;
    const scoreless = config.vba_scheduling_mode === 'scoreless';
    const sorted = movable.slice();
    if (!scoreless) {
        sorted.sort((a, b) => atomTotal(b) - atomTotal(a));
    } else {
        const males = shuffleArr(movable.filter(a => atomGender(a) !== '女'), rnd);
        const females = shuffleArr(movable.filter(a => atomGender(a) === '女'), rnd);
        while (males.length || females.length) {
            if (males.length) sorted.push(males.shift());
            if (females.length) sorted.push(females.shift());
        }
    }

    let highCount = Math.max(0, Math.round((config.vba_high_count || 0) / classNum) * classNum);
    let lowCount = Math.max(0, Math.round((config.vba_low_count || 0) / classNum) * classNum);
    if (config.vba_gender_separate_snake == 1 && !scoreless) {
        // 按性别分别蛇形：高段 = 男前半 + 女前半 交替
        const half = Math.floor(highCount / 2);
        const males = sorted.filter(a => atomGender(a) !== '女');
        const females = sorted.filter(a => atomGender(a) === '女');
        const highMales = males.slice(0, half);
        const highFemales = females.slice(0, half);
        const highSet = new Set([...highMales, ...highFemales]);
        const newSorted = [];
        for (let i = 0; i < Math.max(highMales.length, highFemales.length); i++) {
            if (highMales[i]) newSorted.push(highMales[i]);
            if (highFemales[i]) newSorted.push(highFemales[i]);
        }
        newSorted.push(...sorted.filter(a => !highSet.has(a)));
        sorted.length = 0; sorted.push(...newSorted);
    }
    highCount = Math.min(highCount, sorted.length);
    lowCount = Math.min(lowCount, sorted.length - highCount);
    const totalBands = Math.ceil(sorted.length / classNum) || 1;

    // 构建填充段：标准模式段宽=classNum；逐段均衡版中间段宽=classNum×combo2
    const combo2 = Math.max(1, config.vba_combo2 || 3);
    const isBbB = config.vba_scheduling_mode === 'band_by_band';
    const segments = [];
    const highBands = Math.floor(highCount / classNum);
    const lowBands = Math.floor(lowCount / classNum);

    let idx = 0;
    // 高分段：每个 band 一个段
    for (let b = 0; b < highBands && idx < sorted.length; b++) {
        segments.push({ items: sorted.slice(idx, idx + classNum), type: 'high' });
        idx += classNum;
    }
    // 中间段
    const midEnd = sorted.length - lowBands * classNum;
    const midWidth = isBbB ? classNum * combo2 : classNum;
    while (idx < midEnd) {
        const w = Math.min(midWidth, midEnd - idx);
        segments.push({ items: sorted.slice(idx, idx + w), type: 'mid' });
        idx += w;
    }
    // 低分段
    while (idx < sorted.length) {
        const w = Math.min(classNum, sorted.length - idx);
        segments.push({ items: sorted.slice(idx, idx + w), type: 'low' });
        idx += w;
    }

    // 每段一个随机班级顺序（Band 种子则固定）
    const seedOrder = parseBandSeed(config.vba_band_seed, classNum);

    // 人数均衡分配：原子优先分给当前人数最少的班（同分按蛇形顺序轮转）。
    // 绑定组是"大原子"，若严格按位置取模分配，大原子落谁的位谁的班就多 1 人，累积导致班级人数失衡。
    // 后续 2-opt/rangeFix 均为成对交换（人数守恒），所以 init 阶段的人数均衡即最终人数均衡。
    const countArr = Array(classNum + 1).fill(0);
    for (const a of atoms) if (a.locked && a.classId >= 1 && a.classId <= classNum) countArr[a.classId] += a.members.length;
    const assignBalanced = (items, seq) => {
        let p = 0;
        for (const a of items) {
            let best = seq[0], bestCnt = Infinity;
            for (let k = 0; k < seq.length; k++) {
                const c = seq[(p + k) % seq.length];
                if (countArr[c] < bestCnt) { bestCnt = countArr[c]; best = c; }
            }
            a.classId = best;
            countArr[best] += a.members.length;
            p = (p + 1) % seq.length;
        }
    };

    segments.forEach((seg, si) => {
        const order = seedOrder ? seedOrder.slice() : shuffleArr(Array.from({ length: classNum }, (_, i) => i + 1), rnd);
        let reversed = (si % 2 === 1);
        // 性别交换（第5/9轮）：高分段反向
        if (config.vba_gender_swap == 1 && (runIndex === 4 || runIndex === 8) && seg.type === 'high') reversed = !reversed;
        const seq = reversed ? order.slice().reverse() : order.slice();

        if (config.vba_gender_separate_snake == 1 && !scoreless) {
            const males = seg.items.filter(a => atomGender(a) !== '女');
            const females = seg.items.filter(a => atomGender(a) === '女');
            const seqF = seq.slice().reverse();
            assignBalanced(males, seq);
            assignBalanced(females, seqF);
        } else if (isBbB && seg.type === 'mid') {
            // 逐段均衡版：段内连续填充（跨 band 保持同一顺序）
            assignBalanced(seg.items, seq);
        } else {
            assignBalanced(seg.items, seq);
        }
    });

    return { sorted, highBands, lowBands, totalBands };
}

// ── 2-opt 交换优化（增量求值） ──
function twoOpt(ctx, atoms, movable, maxPasses) {
    if (movable.length < 2) return;
    const cn = ctx.classNum;
    const aggCache = new Map(); // atom -> agg
    for (const a of atoms) aggCache.set(a, atomAgg(a, ctx.dims));

    let improved = true, pass = 0;
    while (improved && pass < maxPasses) {
        improved = false; pass++;
        if (process.env.DEBUG_2OPT) console.error('[2opt] pass', pass, 'cost', totalCost(ctx, atoms).toFixed(2));
        const buckets = Array.from({ length: cn + 1 }, () => []);
        for (const a of movable) if (a.classId >= 1 && a.classId <= cn) buckets[a.classId].push(a);

        for (let ca = 1; ca <= cn; ca++) {
            for (let cb = ca + 1; cb <= cn; cb++) {
                const ba = buckets[ca], bb = buckets[cb];
                for (let x = 0; x < ba.length; x++) {
                    for (let y = 0; y < bb.length; y++) {
                        const A = ba[x], B = bb[y];
                        const aggA = aggCache.get(A), aggB = aggCache.get(B);
                        const oldPair = classCost(ctx, ctx.classAgg[ca]) + classCost(ctx, ctx.classAgg[cb]);
                        // 先真正交换（classId + 聚合统计）
                        const t = A.classId; A.classId = B.classId; B.classId = t;
                        subFrom(ctx.classAgg[ca], aggA); addTo(ctx.classAgg[ca], aggB);
                        subFrom(ctx.classAgg[cb], aggB); addTo(ctx.classAgg[cb], aggA);
                        // 局部互斥检查 + 代价比较
                        const ok = excludeOkForSwap(atoms, A, B);
                        const accept = ok && (classCost(ctx, ctx.classAgg[ca]) + classCost(ctx, ctx.classAgg[cb])) < oldPair - 1e-9;
                        if (accept) {
                            improved = true;
                            const t2 = ba[x]; ba[x] = bb[y]; bb[y] = t2;  // 同步桶
                        } else {
                            // 撤销交换
                            const r = A.classId; A.classId = B.classId; B.classId = r;
                            subFrom(ctx.classAgg[ca], aggB); addTo(ctx.classAgg[ca], aggA);
                            subFrom(ctx.classAgg[cb], aggA); addTo(ctx.classAgg[cb], aggB);
                        }
                    }
                }
            }
        }
    }
}

// ── 极差后处理：贪心交换最小化总分均分极差 ──
function rangeFix(ctx, atoms, movable, maxIters) {
    if (movable.length < 2) return;
    const cn = ctx.classNum;
    const aggCache = new Map();
    for (const a of atoms) aggCache.set(a, atomAgg(a, ctx.dims));
    const totalDim = ctx.dims.length - 1; // __total

    for (let iter = 0; iter < maxIters; iter++) {
        let maxC = 0, minC = 0, maxAvg = -Infinity, minAvg = Infinity;
        for (let c = 1; c <= cn; c++) {
            const g = ctx.classAgg[c];
            if (g.n === 0) continue;
            const avg = g.dims[totalDim] / g.n;
            if (avg > maxAvg) { maxAvg = avg; maxC = c; }
            if (avg < minAvg) { minAvg = avg; minC = c; }
        }
        if (maxC === 0 || maxC === minC) break;
        const curRange = maxAvg - minAvg;
        if (curRange < 1e-6) break;

        const fromMax = movable.filter(a => a.classId === maxC).sort((a, b) => atomTotal(b) - atomTotal(a)).slice(0, 6);
        const fromMin = movable.filter(a => a.classId === minC).sort((a, b) => atomTotal(a) - atomTotal(b)).slice(0, 6);
        let bestA = null, bestB = null, bestRange = curRange;
        for (const A of fromMax) {
            for (const B of fromMin) {
                const aggA = aggCache.get(A), aggB = aggCache.get(B);
                const oldPairCost = classCost(ctx, ctx.classAgg[maxC]) + classCost(ctx, ctx.classAgg[minC]);
                const t = A.classId; A.classId = B.classId; B.classId = t;
                subFrom(ctx.classAgg[maxC], aggA); addTo(ctx.classAgg[maxC], aggB);
                subFrom(ctx.classAgg[minC], aggB); addTo(ctx.classAgg[minC], aggA);
                const ok = excludeOkForSwap(atoms, A, B);
                let range = Infinity, newPairCost = Infinity;
                if (ok) {
                    const a1 = ctx.classAgg[maxC].n ? ctx.classAgg[maxC].dims[totalDim] / ctx.classAgg[maxC].n : 0;
                    const a2 = ctx.classAgg[minC].n ? ctx.classAgg[minC].dims[totalDim] / ctx.classAgg[minC].n : 0;
                    range = Math.abs(a1 - a2);
                    newPairCost = classCost(ctx, ctx.classAgg[maxC]) + classCost(ctx, ctx.classAgg[minC]);
                }
                const r = A.classId; A.classId = B.classId; B.classId = r;
                subFrom(ctx.classAgg[maxC], aggB); addTo(ctx.classAgg[maxC], aggA);
                subFrom(ctx.classAgg[minC], aggA); addTo(ctx.classAgg[minC], aggB);
                // 极差改善 且 总代价不上升 才接受（避免破坏成绩/性别/W 均衡）
                if (ok && range < bestRange - 1e-9 && newPairCost <= oldPairCost + 1e-6) {
                    bestRange = range; bestA = A; bestB = B; bestPairCost = newPairCost;
                }
            }
        }
        if (!bestA) break;
        const aggA = aggCache.get(bestA), aggB = aggCache.get(bestB);
        subFrom(ctx.classAgg[maxC], aggA); addTo(ctx.classAgg[maxC], aggB);
        subFrom(ctx.classAgg[minC], aggB); addTo(ctx.classAgg[minC], aggA);
        const t = bestA.classId; bestA.classId = bestB.classId; bestB.classId = t;
    }
}

/**
 * 执行单轮：蛇形 + 2-opt + 极差后处理
 * 返回 { assignments: Map(student->classId), cost, bandOrders, highBands, lowBands, totalBands }
 */
function runOnce(students, config, runIndex, dims, rnd) {
    const classNum = config.class_num;
    const atoms = buildAtoms(students, classNum);
    const movable = atoms.filter(a => !a.locked);
    const scoreless = config.vba_scheduling_mode === 'scoreless';

    const info = snakeInit(atoms, movable, config, runIndex, rnd);

    // 锁定预设
    for (const a of atoms) if (a.locked) a.classId = a.fixedClass;

    // 修复蛇形阶段的互斥冲突（2-opt 局部检查要求基础状态合法）
    repairExcludes(atoms, movable, rnd);
    if (dbg0()) console.error('[stage] post-snake violations:', countViol(atoms), 'exclOK:', quickExcludeCheck(atoms));

    const ctx = makeCtx(atoms, classNum, config, dims, scoreless);
    const maxPasses = scoreless ? 8 : 15;
    twoOpt(ctx, atoms, movable, maxPasses);
    if (dbg0()) console.error('[stage] after twoOpt:', totalCost(ctx, atoms).toFixed(2), '| fresh:', totalCost(makeCtx(atoms, classNum, config, dims, scoreless), atoms).toFixed(2), '| violations:', countViol(atoms));
    if (!scoreless) {
        const fixIters = { fast: 40, balanced: 300, precision: 900 }[config.vba_range_fix_mode] || 40;
        rangeFix(ctx, atoms, movable, fixIters);
        if (dbg0()) console.error('[stage] after rangeFix:', totalCost(makeCtx(atoms, classNum, config, dims, scoreless), atoms).toFixed(2));
    }
    // 最终兜底：确保互斥约束满足
    repairExcludes(atoms, movable, rnd);
    if (dbg0()) console.error('[stage] after repairExcludes:', totalCost(makeCtx(atoms, classNum, config, dims, scoreless), atoms).toFixed(2), '| violations:', countViol(atoms));

    const assignments = new Map();
    for (const a of atoms) for (const m of a.members) assignments.set(m, a.classId);
    const cost = totalCost(makeCtx(atoms, classNum, config, dims, scoreless), atoms);

    // 记录每段班级顺序（供结果页展示）
    const bandOrders = [];
    const segCount = Math.ceil(atoms.reduce((s, a) => s + a.members.length, 0) / classNum) || 1;
    for (let b = 0; b < segCount; b++) {
        bandOrders.push(Array.from({ length: classNum }, (_, i) => i + 1));
    }
    return { assignments, cost, bandOrders, highBands: info.highBands, lowBands: info.lowBands, totalBands: info.totalBands };
}

/** 构建维度取值器：各学科 + 总分 */
function buildDims(subjects) {
    const dims = subjects.map(sub => ({
        name: sub,
        get: s => (s.extra_scores && s.extra_scores[sub] !== undefined) ? Number(s.extra_scores[sub]) : 0
    }));
    dims.push({ name: '__total', get: s => Number(s.total_score) || 0 });
    return dims;
}

module.exports = {
    mulberry32, shuffleArr, buildAtoms, detectConflicts, runOnce, buildDims,
    quickExcludeCheck, parseBandSeed
};
