/**
 * 中小学智能分班管理系统 — 客户端导出逻辑
 *
 * 提供三个层次的导出能力：
 * 1. SheetJS (xlsx) — 模板下载、简单名单导出（轻量、无格式要求）
 * 2. ExcelJS — 分班结果多工作表带格式导出（丰富格式、CLAUDE.md 行高规范）
 * 3. 服务端直链 — 通过 ?action=export_* 直接下载服务器端生成的 Excel
 */

'use strict';

// ================================================================
// 1. 导入模板下载 (SheetJS — 客户端生成)
// ================================================================
function downloadImportTemplateClient() {
    try {
        var headers = ['姓名', '性别', '语文', '数学', '英语', 'W住校', 'B备注', '绑定组', '互斥组', '预设班级'];
        var samples = [
            ['张三', '男', 85, 92, 78, '是', '', 0, 0, ''],
            ['李四', '女', 90, 88, 95, '否', '校篮球队', 1, 0, ''],
            ['王五', '男', 72, 80, 68, '是', '', 0, 1, ''],
        ];
        var data = [headers].concat(samples);
        var ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = headers.map(function(h) {
            return { wch: h === '姓名' ? 12 : (h === '预设班级' ? 10 : 8) };
        });
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '学生名单');
        var wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        var blob = new Blob([wbout], { type: 'application/octet-stream' });
        saveAs(blob, '分班导入模板.xlsx');
    } catch (err) {
        console.error(err);
        alert('模板下载失败：' + err.message + '\n请重试或联系管理员。');
    }
}

// ================================================================
// 2. 导出学生名单 (ExcelJS — 带表格边框和格式)
// ================================================================
async function exportRoster() {
    try {
        var resp = await api('students', { page: 1, per_page: 99999 }, 'GET');
        if (!resp || resp.code !== 200 || !resp.data) {
            alert('无法获取学生数据');
            return;
        }
        var students = resp.data;
        if (students.length === 0) {
            alert('没有学生数据可导出');
            return;
        }

        var wb = new ExcelJS.Workbook();
        wb.creator = '中小学智能分班管理系统';
        wb.created = new Date();

        var ws = wb.addWorksheet('学生名单');
        setupSheetView(ws);

        // ── 标题行 ──
        var titleCell = ws.getCell('A1');
        titleCell.value = '中小学智能分班管理系统 — 学生名单';
        titleCell.font = { name: '宋体', size: 14, bold: true };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.mergeCells(1, 1, 1, 13);
        setRowHeight(ws.getRow(1), 28);
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };

        // ── 表头（第2行）──
        var headers = ['ID', '姓名', '性别', '语文', '数学', '英语', '总分', '标签', '住校', '绑定组', '互斥组', '班级', '预设'];
        var headerRow = ws.getRow(2);
        headers.forEach(function(h, i) {
            var cell = ws.getCell(rowColToRef(2, i + 1));
            cell.value = h;
            applyHeaderStyle(cell);
        });
        setRowHeight(headerRow, 24);

        // ── 数据行 ──
        for (var i = 0; i < students.length; i++) {
            var s = students[i];
            var rowNum = i + 3;
            var rowData = [
                s.id, s.name, s.gender,
                parseFloat(s.chinese) || 0,
                parseFloat(s.math) || 0,
                parseFloat(s.english) || 0,
                parseFloat(s.total_score) || 0,
                s.label || '',
                parseInt(s.is_boarding) || 0,
                parseInt(s.bind_group) || 0,
                parseInt(s.exclude_group) || 0,
                s.class_id > 0 ? s.class_id + '班' : '',
                s.is_preset > 0 ? '是' : ''
            ];
            rowData.forEach(function(val, ci) {
                var cell = ws.getCell(rowColToRef(rowNum, ci + 1));
                cell.value = val;
                cell.font = { name: '宋体', size: 10 };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = thinBorder();
            });
            setRowHeight(ws.getRow(rowNum), 16);
        }

        // ── 列宽 ──
        var colWidths = [6, 10, 6, 8, 8, 8, 8, 12, 6, 8, 8, 8, 6];
        colWidths.forEach(function(w, ci) {
            ws.getColumn(ci + 1).width = w;
        });

        // ── 冻结 + 筛选 ──
        ws.views = [{ state: 'frozen', ySplit: 2 }];
        ws.autoFilter = { from: 'A2', to: rowColToRef(2, headers.length) };

        // ── 输出 ──
        var buffer = await wb.xlsx.writeBuffer();
        var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, '学生名单_' + formatDate() + '.xlsx');
    } catch (err) {
        console.error(err);
        alert('导出失败：' + err.message);
    }
}

// ================================================================
// 3. 导出分班结果 (ExcelJS — 多工作表带格式)
// ================================================================
async function exportResults() {
    try {
        // 获取结果数据
        var resp = await api('result');
        if (!resp || !resp.classes) {
            alert('没有分班结果可导出。请先完成分班。');
            return;
        }

        var wb = new ExcelJS.Workbook();
        wb.creator = '中小学智能分班管理系统';
        wb.created = new Date();

        // ── Sheet 1: 各班汇总 ──
        addSummarySheet(wb, resp);

        // ── Sheet 2: 全校排名 ──
        addRankingSheet(wb, resp);

        // ── Sheet 3: 排名段分布 ──
        if (resp.band_table_top) {
            addBandSheet(wb, resp, '排名段分布(前N名)', resp.band_table_top);
        }
        if (resp.band_table_bottom) {
            addBandSheet(wb, resp, '排名段分布(后N名)', resp.band_table_bottom);
        }

        // ── Sheet 4: 学科优秀生分布（如有）──
        if (resp.subject_distribution && resp.subject_distribution.length > 0) {
            addSubjectSheet(wb, resp);
        }

        // 输出
        var buffer = await wb.xlsx.writeBuffer();
        var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, '分班结果_' + formatDate() + '.xlsx');
    } catch (err) {
        console.error(err);
        alert('导出失败：' + err.message + '\n请尝试使用"服务端导出完整报告"。');
    }
}

// ================================================================
// Sheet 构建函数
// ================================================================

/**
 * 各班汇总工作表
 */
function addSummarySheet(wb, resp) {
    var ws = wb.addWorksheet('各班汇总');
    setupSheetView(ws);

    var classes = resp.classes || [];
    var cids = Object.keys(classes).sort(function(a, b) { return parseInt(a) - parseInt(b); });
    var labelTypes = resp.label_types || [];

    // 标题行
    var titleCell = ws.getCell('A1');
    titleCell.value = '中小学智能分班管理系统 — 分班结果汇总';
    titleCell.font = { name: '宋体', size: 14, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(1, 1, 8 + labelTypes.length, 1);
    setRowHeight(ws.getRow(1), 28);

    // 表头（第3行）
    var headers = ['班级', '人数', '语文均分', '数学均分', '英语均分', '总分均分', '男生', '女生', '住校'];
    headers = headers.concat(labelTypes);
    var headerRow = ws.getRow(3);
    headers.forEach(function(h, i) {
        var cell = ws.getCell(rowColToRef(3, i + 1));
        cell.value = h;
        applyHeaderStyle(cell);
    });
    setRowHeight(headerRow, 22);

    // 数据
    var rowIdx = 4;
    var totals = { count: 0, chinese: 0, math: 0, english: 0, total: 0, male: 0, female: 0, boarding: 0, labels: {} };
    cids.forEach(function(cid) {
        var students = classes[cid] || [];
        var cnt = students.length;
        totals.count += cnt;
        var cSum = students.reduce(function(s, st) { return s + parseFloat(st.chinese || 0); }, 0);
        var mSum = students.reduce(function(s, st) { return s + parseFloat(st.math || 0); }, 0);
        var eSum = students.reduce(function(s, st) { return s + parseFloat(st.english || 0); }, 0);
        var tSum = students.reduce(function(s, st) { return s + parseFloat(st.total_score || 0); }, 0);
        var male = students.filter(function(st) { return st.gender === '男'; }).length;
        var female = cnt - male;
        var boarding = students.filter(function(st) { return parseInt(st.is_boarding) === 1; }).length;

        totals.chinese += cSum;
        totals.math += mSum;
        totals.english += eSum;
        totals.total += tSum;
        totals.male += male;
        totals.female += female;
        totals.boarding += boarding;

        var rowData = [cid, cnt,
            (cSum / cnt).toFixed(2), (mSum / cnt).toFixed(2), (eSum / cnt).toFixed(2),
            (tSum / cnt).toFixed(2), male, female, boarding];
        labelTypes.forEach(function(lbl) {
            var lCnt = students.filter(function(st) { return st.label === lbl; }).length;
            rowData.push(lCnt);
            totals.labels[lbl] = (totals.labels[lbl] || 0) + lCnt;
        });

        rowData.forEach(function(val, ci) {
            var cell = ws.getCell(rowColToRef(rowIdx, ci + 1));
            cell.value = isNaN(val) ? val : (typeof val === 'number' ? val : parseFloat(val));
            cell.font = { name: '宋体', size: 10 };
            cell.border = thinBorder();
        });
        setRowHeight(ws.getRow(rowIdx), 16);
        rowIdx++;
    });

    // 全校汇总行
    var totalData = ['全校', totals.count,
        (totals.chinese / totals.count).toFixed(2),
        (totals.math / totals.count).toFixed(2),
        (totals.english / totals.count).toFixed(2),
        (totals.total / totals.count).toFixed(2),
        totals.male, totals.female, totals.boarding];
    labelTypes.forEach(function(lbl) {
        totalData.push(totals.labels[lbl] || 0);
    });
    totalData.forEach(function(val, ci) {
        var cell = ws.getCell(rowColToRef(rowIdx, ci + 1));
        cell.value = val;
        cell.font = { name: '宋体', size: 10, bold: true };
        cell.border = thinBorder();
    });
    setRowHeight(ws.getRow(rowIdx), 18);

    // 列宽
    var colCount = headers.length;
    for (var c = 1; c <= colCount; c++) {
        ws.getColumn(c).width = c === 1 ? 8 : 12;
    }

    // 冻结
    ws.views = [{ state: 'frozen', ySplit: 3 }];
}

/**
 * 全校排名工作表
 */
function addRankingSheet(wb, resp) {
    var ws = wb.addWorksheet('全校排名');
    setupSheetView(ws);

    var allSorted = resp.all_sorted || [];
    if (allSorted.length === 0) {
        ws.getCell('A1').value = '无排名数据';
        return;
    }

    var headers = ['排名', '姓名', '性别', '语文', '数学', '英语', '总分', '标签', '班级', '段内位置', '分段'];
    var headerRow = ws.getRow(1);
    headers.forEach(function(h, i) {
        var cell = ws.getCell(rowColToRef(1, i + 1));
        cell.value = h;
        applyHeaderStyle(cell);
    });
    setRowHeight(headerRow, 22);

    allSorted.forEach(function(s, ri) {
        var rowNum = ri + 2;
        var seg = s.segment || '中';
        var rowData = [ri + 1, s.name, s.gender, s.chinese, s.math, s.english,
                       s.total_score, s.label, s.class_id + '班', s.band_pos, seg];
        rowData.forEach(function(val, ci) {
            var cell = ws.getCell(rowColToRef(rowNum, ci + 1));
            cell.value = val;
            cell.font = { name: '宋体', size: 10 };
            cell.border = thinBorder();
            if (seg === '高') {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
            } else if (seg === '低') {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
            }
        });
        setRowHeight(ws.getRow(rowNum), 16);
    });

    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 10;
    for (var c = 3; c <= headers.length; c++) {
        ws.getColumn(c).width = 8;
    }

    ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * 排名段分布工作表
 */
function addBandSheet(wb, resp, title, bandData) {
    var ws = wb.addWorksheet(title);
    setupSheetView(ws);

    if (!bandData || bandData.length === 0) {
        ws.getCell('A1').value = '无数据';
        return;
    }

    var cids = Object.keys(resp.classes || {}).sort(function(a, b) { return parseInt(a) - parseInt(b); });
    var allHeaders = ['累计排名段'].concat(cids.map(function(c) { return c + '班'; }));
    var headerRow = ws.getRow(1);
    allHeaders.forEach(function(h, i) {
        var cell = ws.getCell(rowColToRef(1, i + 1));
        cell.value = h;
        applyHeaderStyle(cell);
    });
    setRowHeight(headerRow, 22);

    bandData.forEach(function(row, ri) {
        var rowNum = ri + 2;
        ws.getCell(rowColToRef(rowNum, 1)).value = row.label || '';
        ws.getCell(rowColToRef(rowNum, 1)).font = { name: '宋体', size: 10 };
        ws.getCell(rowColToRef(rowNum, 1)).border = thinBorder();
        cids.forEach(function(cid, ci) {
            var cell = ws.getCell(rowColToRef(rowNum, ci + 2));
            cell.value = (row.classes && row.classes[ci] !== undefined) ? row.classes[ci] : 0;
            cell.font = { name: '宋体', size: 10 };
            cell.border = thinBorder();
            cell.alignment = { horizontal: 'center' };
        });
        setRowHeight(ws.getRow(rowNum), 16);
    });

    ws.getColumn(1).width = 14;
    cids.forEach(function(_, ci) {
        ws.getColumn(ci + 2).width = 8;
    });

    ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * 学科优秀生分布工作表
 */
function addSubjectSheet(wb, resp) {
    var ws = wb.addWorksheet('学科优秀生分布');
    setupSheetView(ws);

    var dist = resp.subject_distribution || [];
    if (dist.length === 0) {
        ws.getCell('A1').value = '无学科优秀生数据';
        return;
    }

    var cids = Object.keys(resp.classes || {}).sort(function(a, b) { return parseInt(a) - parseInt(b); });
    var rowIdx = 1;

    dist.forEach(function(subj) {
        var subjName = subj.name || '';
        var classCounts = subj.class_counts || [];
        var totalCount = subj.total || 0;
        var rangeVal = subj.range || 0;

        ws.getCell(rowColToRef(rowIdx, 1)).value = subjName + '（≥' + (subj.threshold || 0) + '分）';
        ws.getCell(rowColToRef(rowIdx, 1)).font = { name: '宋体', size: 12, bold: true };
        rowIdx++;

        var headers = ['班级'].concat(cids.map(function(c) { return c + '班'; })).concat(['总计', '极差']);
        var hRow = ws.getRow(rowIdx);
        headers.forEach(function(h, i) {
            var cell = ws.getCell(rowColToRef(rowIdx, i + 1));
            cell.value = h;
            applyHeaderStyle(cell);
        });
        rowIdx++;

        cids.forEach(function(_, ci) {
            var v = classCounts[ci] || 0;
            ws.getCell(rowColToRef(rowIdx, ci + 2)).value = v;
        });
        ws.getCell(rowColToRef(rowIdx, cids.length + 2)).value = totalCount;
        ws.getCell(rowColToRef(rowIdx, cids.length + 3)).value = rangeVal;
        ws.getCell(rowColToRef(rowIdx, 1)).value = '人数';

        for (var c = 1; c <= cids.length + 3; c++) {
            var cell = ws.getCell(rowColToRef(rowIdx, c));
            cell.font = { name: '宋体', size: 10 };
            cell.border = thinBorder();
            cell.alignment = { horizontal: 'center' };
        }
        setRowHeight(ws.getRow(rowIdx), 16);
        rowIdx += 2;
    });

    ws.getColumn(1).width = 22;
    cids.forEach(function(_, ci) { ws.getColumn(ci + 2).width = 8; });
}

// ================================================================
// 辅助函数
// ================================================================

/**
 * 设置工作表视图（修复高 DPI 下行高被错误缩放的问题）
 * 必须在每个工作表创建后立即调用
 */
function setupSheetView(ws) {
    ws.views = [{ state: 'normal' }];
}

/**
 * 设置行高（同时设置 height 和 _height，触发 customHeight 标记）
 * 参考 CLAUDE.md 规范
 */
function setRowHeight(row, h) {
    row.height = h;
    row._height = h;
}

/**
 * 应用表头样式（蓝底白字、居中、加粗）
 */
function applyHeaderStyle(cell) {
    cell.font = { name: '宋体', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder();
}

/**
 * 全细线边框
 */
function thinBorder() {
    return {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
    };
}

/**
 * 行列号转 A1 引用
 */
function rowColToRef(row, col) {
    var colStr = '';
    col--;
    do {
        colStr = String.fromCharCode(65 + (col % 26)) + colStr;
        col = Math.floor(col / 26) - 1;
    } while (col >= 0);
    return colStr + row;
}

/**
 * 格式化日期为 YYYYMMDD
 */
function formatDate() {
    var d = new Date();
    return d.getFullYear() +
        ('0' + (d.getMonth() + 1)).slice(-2) +
        ('0' + d.getDate()).slice(-2);
}
