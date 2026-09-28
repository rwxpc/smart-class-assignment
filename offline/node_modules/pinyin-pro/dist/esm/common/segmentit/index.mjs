import { PatternsNormal } from '../../data/patterns.mjs';
export { PatternsNormal } from '../../data/patterns.mjs';
import { maxProbability } from './max-probability.mjs';
import { minTokenization } from './min-tokenization.mjs';
import { reverseMaxMatch } from './reverse-max-match.mjs';
import { Priority } from '../constant.mjs';
import { splitString } from '../utils.mjs';

var TokenizationAlgorithm;
(function (TokenizationAlgorithm) {
    TokenizationAlgorithm[TokenizationAlgorithm["ReverseMaxMatch"] = 1] = "ReverseMaxMatch";
    TokenizationAlgorithm[TokenizationAlgorithm["MaxProbability"] = 2] = "MaxProbability";
    TokenizationAlgorithm[TokenizationAlgorithm["MinTokenization"] = 3] = "MinTokenization";
})(TokenizationAlgorithm || (TokenizationAlgorithm = {}));
class TrieNode {
    constructor(parent, key = "") {
        this.children = new Map();
        this.fail = null;
        this.patterns = [];
        this.parent = parent;
        this.key = key;
    }
}
class AC {
    constructor() {
        this.dictMap = new Map();
        this.queues = [];
        this.root = new TrieNode(null);
    }
    build(patternList) {
        this.buildTrie(patternList);
        this.buildFailPointer();
    }
    // 构建 trie 树
    buildTrie(patternList) {
        for (let pattern of patternList) {
            const zhChars = splitString(pattern.zh);
            let cur = this.root;
            for (let i = 0; i < zhChars.length; i++) {
                let c = zhChars[i];
                if (!cur.children.has(c)) {
                    const trieNode = new TrieNode(cur, c);
                    cur.children.set(c, trieNode);
                    this.addNodeToQueues(trieNode, i + 1);
                }
                cur = cur.children.get(c);
            }
            this.insertPattern(cur.patterns, pattern);
            pattern.node = cur;
            this.addPatternToDictMap(pattern);
        }
    }
    // 构建失败指针
    buildFailPointer() {
        let queue = [];
        let queueIndex = 0;
        this.queues.forEach((_queue) => {
            queue = queue.concat(_queue);
        });
        this.queues = [];
        while (queue.length > queueIndex) {
            let node = queue[queueIndex++];
            let failNode = node.parent && node.parent.fail;
            let key = node.key;
            while (failNode && !failNode.children.has(key)) {
                failNode = failNode.fail;
            }
            if (!failNode) {
                node.fail = this.root;
            }
            else {
                node.fail = failNode.children.get(key);
            }
        }
    }
    // 将 pattern 添加到 dictMap 中
    addPatternToDictMap(pattern) {
        if (!this.dictMap.has(pattern.dict)) {
            this.dictMap.set(pattern.dict, new Set());
        }
        this.dictMap.get(pattern.dict).add(pattern);
    }
    addNodeToQueues(trieNode, depth) {
        if (!this.queues[depth]) {
            this.queues[depth] = [];
        }
        this.queues[depth].push(trieNode);
    }
    // 按照优先级插入 pattern
    insertPattern(patterns, pattern) {
        for (let i = patterns.length - 1; i >= 0; i--) {
            const _pattern = patterns[i];
            if (pattern.priority === _pattern.priority &&
                pattern.probability >= _pattern.probability) {
                patterns[i + 1] = _pattern;
            }
            else if (pattern.priority > _pattern.priority) {
                patterns[i + 1] = _pattern;
            }
            else {
                patterns[i + 1] = pattern;
                return;
            }
        }
        patterns[0] = pattern;
    }
    removeDict(dictName) {
        if (this.dictMap.has(dictName)) {
            const set = this.dictMap.get(dictName);
            set.forEach((pattern) => {
                pattern.node.patterns = pattern.node.patterns.filter((_pattern) => _pattern !== pattern);
            });
            this.dictMap.delete(dictName);
        }
    }
    // 搜索字符串返回匹配的模式串
    match(text, surname, zhChars = splitString(text)) {
        let cur = this.root;
        let result = [];
        for (let i = 0; i < zhChars.length; i++) {
            let c = zhChars[i];
            let next = cur.children.size ? cur.children.get(c) : undefined;
            while (!next && cur !== this.root) {
                if (!cur.fail) {
                    cur = this.root;
                    break;
                }
                cur = cur.fail;
                next = cur.children.size ? cur.children.get(c) : undefined;
            }
            if (next) {
                cur = next;
                const pattern = cur.patterns.find((item) => {
                    if (surname === "off") {
                        return item.priority !== Priority.Surname;
                    }
                    else if (surname === "head") {
                        return item.length - 1 - i === 0;
                    }
                    else {
                        return true;
                    }
                });
                if (pattern) {
                    result.push(Object.assign(Object.assign({}, pattern), { index: i - pattern.length + 1 }));
                }
                let failNode = cur.fail;
                while (failNode !== null) {
                    const pattern = failNode.patterns.find((item) => {
                        if (surname === "off") {
                            return item.priority !== Priority.Surname;
                        }
                        else if (surname === "head") {
                            return item.length - 1 - i === 0;
                        }
                        else {
                            return true;
                        }
                    });
                    if (pattern) {
                        result.push(Object.assign(Object.assign({}, pattern), { index: i - pattern.length + 1 }));
                    }
                    failNode = failNode.fail;
                }
            }
        }
        return result;
    }
    search(text, surname, algorithm = 2 /* TokenizationAlgorithm.MaxProbability */, zhChars = splitString(text)) {
        const patterns = this.match(text, surname, zhChars);
        if (algorithm === 1 /* TokenizationAlgorithm.ReverseMaxMatch */) {
            return reverseMaxMatch(patterns);
        }
        else if (algorithm === 3 /* TokenizationAlgorithm.MinTokenization */) {
            return minTokenization(patterns, zhChars.length);
        }
        return maxProbability(patterns, zhChars.length);
    }
}
let acBuilt = false;
const acTree = new AC();
function ensureAcBuilt() {
    if (!acBuilt) {
        acTree.build(PatternsNormal);
        acBuilt = true;
    }
}
function scheduleAcBuild() {
    if (typeof requestIdleCallback === "function") {
        requestIdleCallback(() => ensureAcBuilt());
    }
    else {
        setTimeout(ensureAcBuilt, 0);
    }
}
scheduleAcBuild();

export { AC, TokenizationAlgorithm, acTree, ensureAcBuilt, scheduleAcBuild };
