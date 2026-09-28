/**
 * prep-template.js — 把抓取的主应用 HTML 转换为带占位符的模板
 * 运行一次即可：node prep-template.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'site_mirror', 'main.html');
const dst = path.join(__dirname, 'public', 'app.html');
let html = fs.readFileSync(src, 'utf8');

// 1. csrf token（meta 标签）
html = html.replace(/<meta name="csrf-token" content="[0-9a-f]*">/, '<meta name="csrf-token" content="{{CSRF}}">');

// 2. 侧边栏用户信息
html = html.replace(/(<div style="font-size:12px;color:#94a3b8;margin-bottom:2px">👤 )([^<]+)(<\/div>)/, '$1{{DISPLAY_NAME}}$3');
html = html.replace(/(<div style="font-size:11px;color:#64748b">@)([^<]+)(<\/div>)/, '$1{{USERNAME}}$3');

// 3. 顶栏状态徽章
html = html.replace(/状态:\s*\w+(\s+<\/span>)/, '状态: {{STATUS_TEXT}}$1');

// 4. 学科分数数据（PHP 注入）
html = html.replace(/let _subjectScores = \{[^}]*\};/, 'let _subjectScores = {{SUBJECT_SCORES}};');
html = html.replace(/let _scoreSubjects = \[[^\]]*\];/, 'let _scoreSubjects = {{SCORE_SUBJECTS}};');

// 5. 初始状态
html = html.replace(/const status = '\w+';/, "const status = '{{STATUS}}';");

// 6. 无学生数据提示（条件显示）
html = html.replace(/<div class="alert alert-info">📌 当前没有学生数据，建议先生成模拟数据以体验系统功能。<\/div>/, '{{MOCK_ALERT}}');

// 7. 管理员导航（仅管理员注入）
html = html.replace(/(\n(\s*)<a data-page="change-password")/, '\n$2{{ADMIN_LINK}}$1');

fs.writeFileSync(dst, html, 'utf8');
console.log('模板已生成:', dst, '长度:', html.length);
// 校验占位符
const placeholders = html.match(/\{\{[A-Z_]+\}\}/g) || [];
console.log('占位符:', Array.from(new Set(placeholders)).join(', '));
