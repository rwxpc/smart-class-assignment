/**
 * store.js — 离线版数据持久层
 * 每个用户一个数据目录：data/users/<id>/{students.json, config.json, runstate.json}
 * 全局：data/users.json、data/feedback.json、data/sessions.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');

function ensureDirs() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(USERS_DIR, { recursive: true });
}
ensureDirs();

function readJson(file, def) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; }
}
function writeJson(file, obj) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), 'utf8');
    fs.renameSync(tmp, file);
}

// ── 密码散列 ──
function hashPassword(password, salt) {
    salt = salt || crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + ':' + password).digest('hex');
    return salt + '$' + hash;
}
function verifyPassword(password, stored) {
    if (!stored) return false;
    const idx = stored.indexOf('$');
    if (idx < 0) return false;
    const salt = stored.substring(0, idx);
    return hashPassword(password, salt) === stored;
}

// ── 用户 ──
const usersFile = path.join(DATA_DIR, 'users.json');
function loadUsers() { return readJson(usersFile, []); }
function saveUsers(list) { writeJson(usersFile, list); }

function userDir(id) { return path.join(USERS_DIR, String(id)); }
function ensureUserDir(id) {
    const d = userDir(id);
    fs.mkdirSync(d, { recursive: true });
    return d;
}

function getUserById(id) {
    return loadUsers().find(u => u.id === id) || null;
}
function getUserByUsername(username) {
    return loadUsers().find(u => u.username === username) || null;
}
function createUser(username, password, displayName) {
    const users = loadUsers();
    const maxId = users.reduce((m, u) => Math.max(m, u.id), 0);
    const user = {
        id: maxId + 1,
        username,
        password: hashPassword(password),
        display_name: displayName || username,
        is_admin: users.length === 0 ? 1 : 0,   // 首个注册用户为管理员
        is_disabled: 0,
        vba_authorized_modes: '',
        created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };
    users.push(user);
    saveUsers(users);
    ensureUserDir(user.id);
    return user;
}
function updateUser(id, patch) {
    const users = loadUsers();
    const u = users.find(x => x.id === id);
    if (!u) return null;
    Object.assign(u, patch);
    saveUsers(users);
    return u;
}
function deleteUser(id) {
    let users = loadUsers();
    users = users.filter(u => u.id !== id);
    saveUsers(users);
    try { fs.rmSync(userDir(id), { recursive: true, force: true }); } catch (e) {}
}

// ── 每用户数据 ──
function getDefaultConfig() {
    return {
        class_num: 7,
        multi_run_count: 10,
        opt2_time_limit: 100,
        vba_perturb_ratio: 0.35,
        vba_high_count: 78,
        vba_low_count: 36,
        vba_gender_swap: 1,
        vba_gender_separate_snake: 0,
        vba_scheduling_mode: 'standard',
        vba_judgment_mode: 'standard',
        vba_range_fix_mode: 'fast',
        vba_constrain_bands: 1,
        vba_band_seed: '',
        vba_combo1: 1,
        vba_combo2: 3,
        use_subject_balance: 0,
        subject_thresholds: []
    };
}

function loadStudents(userId) { return readJson(path.join(userDir(userId), 'students.json'), []); }
function saveStudents(userId, students) { ensureUserDir(userId); writeJson(path.join(userDir(userId), 'students.json'), students); }

function loadConfig(userId) {
    const c = readJson(path.join(userDir(userId), 'config.json'), null);
    return Object.assign(getDefaultConfig(), c || {});
}
function saveConfig(userId, config) { ensureUserDir(userId); writeJson(path.join(userDir(userId), 'config.json'), config); }

// 运行状态：{ status, progress, completed_runs, total_runs, best_result:null, band_orders:[] }
function loadRunState(userId) {
    return readJson(path.join(userDir(userId), 'runstate.json'), {
        status: 'idle', progress: 0, completed_runs: 0, total_runs: 0,
        best_result: null, band_orders: []
    });
}
function saveRunState(userId, st) { ensureUserDir(userId); writeJson(path.join(userDir(userId), 'runstate.json'), st); }

// ── 反馈（全局） ──
const feedbackFile = path.join(DATA_DIR, 'feedback.json');
function loadFeedback() { return readJson(feedbackFile, []); }
function saveFeedback(list) { writeJson(feedbackFile, list); }

// ── 会话 ──
const sessionsFile = path.join(DATA_DIR, 'sessions.json');
const sessions = readJson(sessionsFile, {}); // { sid: { userId, csrf, created } }
function saveSessions() { writeJson(sessionsFile, sessions); }
function createSession(userId) {
    const sid = crypto.randomBytes(16).toString('hex');
    sessions[sid] = {
        userId,
        csrf: crypto.createHash('sha256').update(sid + crypto.randomBytes(8)).digest('hex'),
        created: Date.now()
    };
    saveSessions();
    return sid;
}
function getSession(sid) { return sessions[sid] || null; }
function destroySession(sid) { if (sessions[sid]) { delete sessions[sid]; saveSessions(); } }

function nextStudentId(students) {
    return students.reduce((m, s) => Math.max(m, s.id), 0) + 1;
}

module.exports = {
    DATA_DIR,
    hashPassword, verifyPassword,
    loadUsers, saveUsers, getUserById, getUserByUsername, createUser, updateUser, deleteUser,
    loadStudents, saveStudents, loadConfig, saveConfig, getDefaultConfig,
    loadRunState, saveRunState,
    loadFeedback, saveFeedback,
    createSession, getSession, destroySession,
    nextStudentId
};
