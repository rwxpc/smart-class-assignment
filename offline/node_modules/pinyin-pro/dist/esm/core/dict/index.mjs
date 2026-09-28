import { Priority } from '../../common/constant.mjs';
import { ensureAcBuilt, acTree } from '../../common/segmentit/index.mjs';
import { stringLength } from '../../common/utils.mjs';
import DICT1 from '../../data/dict1.mjs';

const DefaultName = Symbol("default");
const originDictMap = new Map();
function addDict(dict, options) {
    ensureAcBuilt();
    const patterns = [];
    // string 类型时：options 为 name（）
    const name = typeof options === "object" ? options.name : options;
    const dictName = name || DefaultName;
    const dict1Handle = (options === null || options === void 0 ? void 0 : options.dict1) || "add";
    for (let word in dict) {
        const value = dict[word];
        const pinyin = Array.isArray(value) ? value[0] : value;
        const wordLength = stringLength(word);
        if (wordLength === 1) {
            addToOriginDict(dictName, word, pinyin, dict1Handle);
        }
        if (Array.isArray(value)) {
            patterns.push({
                zh: word,
                pinyin,
                probability: typeof value[1] === "number"
                    ? value[1]
                    : 2e-8 /* Probability.DICT */ * wordLength * wordLength,
                length: wordLength,
                priority: Priority.Normal,
                dict: dictName,
                pos: typeof value[2] === "string" ? value[2] : "",
            });
        }
        else {
            patterns.push({
                zh: word,
                pinyin,
                probability: 2e-8 /* Probability.DICT */ * wordLength * wordLength,
                length: wordLength,
                priority: Priority.Normal,
                dict: dictName,
            });
        }
    }
    acTree.build(patterns);
}
function removeDict(dictName) {
    acTree.removeDict(dictName || DefaultName);
    removeOriginDict(dictName || DefaultName);
}
function addToOriginDict(dict, char, pinyin, handle = "add") {
    if (!originDictMap.get(dict)) {
        originDictMap.set(dict, {});
    }
    const originDict = originDictMap.get(dict);
    if (!originDict[char]) {
        originDict[char] = DICT1.get(char);
    }
    if (handle === "add") {
        const existedPinyin = DICT1.get(char);
        if (existedPinyin && !existedPinyin.split(' ').includes(pinyin)) {
            DICT1.set(char, `${existedPinyin} ${pinyin}`);
        }
        else if (!DICT1.get(char)) {
            DICT1.set(char, pinyin);
        }
    }
    else if (handle === "replace") {
        DICT1.set(char, pinyin);
    }
}
function removeOriginDict(dict) {
    const originDict = originDictMap.get(dict) || {};
    for (let char in originDict) {
        DICT1.set(char, originDict[char]);
        delete originDict[char];
    }
}

export { addDict, removeDict };
