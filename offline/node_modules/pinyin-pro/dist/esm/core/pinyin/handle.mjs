import { InitialList, doubleFinalList, SpecialInitialList, SpecialFinalList, SpecialFinalMap, toneSandhiList, toneSandhiIgnoreSuffix, toneSandhiMap } from '../../data/special.mjs';
import DICT1 from '../../data/dict1.mjs';
import { getAllPinyin } from './all.mjs';
export { getAllPinyin } from './all.mjs';
import { ensureAcBuilt, acTree } from '../../common/segmentit/index.mjs';
import { Priority } from '../../common/constant.mjs';
import { splitString } from '../../common/utils.mjs';
import { getTraditionalDict } from '../traditional/index.mjs';

const getSingleWordPinyin = (char) => {
    const pinyin = DICT1.get(char);
    // 若查到, 则返回第一个拼音; 若未查到, 返回原字符
    if (!pinyin)
        return char;
    const index = pinyin.indexOf(" ");
    return index === -1 ? pinyin : pinyin.slice(0, index);
};
const getTraditionalWords = (word) => {
    const traditionalWords = [];
    const traditionalDict = getTraditionalDict();
    for (let i = 0; i < word.length; i++) {
        const key = word[i];
        const code = key.charCodeAt(0);
        if (traditionalDict[code]) {
            traditionalWords[i] = traditionalDict[code];
        }
        else {
            traditionalWords[i] = key;
        }
    }
    return traditionalWords.join("");
};
const getPinyin = (word, list, surname, segmentit, traditional, zhChars = splitString(word)) => {
    ensureAcBuilt();
    const searchWord = traditional ? getTraditionalWords(word) : word;
    const searchChars = traditional ? splitString(searchWord) : zhChars;
    const matches = acTree.search(searchWord, surname, segmentit, searchChars);
    let matchIndex = 0;
    const processFuncs = getProcessFuncs(word);
    for (let i = 0; i < zhChars.length;) {
        const match = matches[matchIndex];
        if (match && i === match.index) {
            if (match.length === 1 && match.priority <= Priority.Normal) {
                const char = zhChars[i];
                match.zh = char;
                let pinyin = "";
                pinyin = processSepecialPinyin(char, zhChars[i - 1], zhChars[i + 1], processFuncs);
                list[i] = {
                    origin: char,
                    result: pinyin,
                    isZh: pinyin !== char,
                    originPinyin: pinyin,
                };
                i++;
                matchIndex++;
                continue;
            }
            const pinyins = match.pinyin.split(" ");
            let pinyinIndex = 0;
            if (traditional) {
                match.zh = zhChars
                    .slice(match.index, match.index + match.length)
                    .join("");
            }
            for (let j = 0; j < match.length; j++) {
                list[i + j] = {
                    origin: zhChars[j + match.index],
                    result: pinyins[pinyinIndex] || "",
                    isZh: true,
                    originPinyin: pinyins[pinyinIndex] || "",
                };
                pinyinIndex++;
            }
            i += match.length;
            matchIndex++;
        }
        else {
            const char = zhChars[i];
            let pinyin = "";
            pinyin = processSepecialPinyin(char, zhChars[i - 1], zhChars[i + 1], processFuncs);
            list[i] = {
                origin: char,
                result: pinyin,
                isZh: pinyin !== char,
                originPinyin: pinyin,
            };
            i++;
        }
    }
    return { list, matches };
};
const getPinyinWithoutTone = (pinyin) => {
    return pinyin
        .replace(/(ā|á|ǎ|à)/g, "a")
        .replace(/(ō|ó|ǒ|ò)/g, "o")
        .replace(/(ē|é|ě|è)/g, "e")
        .replace(/(ī|í|ǐ|ì)/g, "i")
        .replace(/(ū|ú|ǔ|ù)/g, "u")
        .replace(/(ǖ|ǘ|ǚ|ǜ)/g, "ü")
        .replace(/(n̄|ń|ň|ǹ)/g, "n")
        .replace(/(m̄|ḿ|m̌|m̀)/g, "m")
        .replace(/(ê̄|ế|ê̌|ề)/g, "ê");
};
const getMultiplePinyin = (word, surname = "off") => {
    let pinyin = getAllPinyin(word, surname);
    if (pinyin.length > 0) {
        return pinyin.map((value) => ({
            origin: word,
            result: value,
            isZh: true,
            originPinyin: value,
        }));
    }
    else {
        return [
            {
                origin: word,
                result: word,
                isZh: false,
                originPinyin: word,
            },
        ];
    }
};
const getInitialAndFinal = (pinyin, initialPattern) => {
    const pinyin_arr = pinyin.split(" ");
    const initial_arr = [];
    const final_arr = [];
    for (let _pinyin of pinyin_arr) {
        for (let _initial of InitialList) {
            if (_pinyin.startsWith(_initial)) {
                let _final = _pinyin.slice(_initial.length);
                if (SpecialInitialList.indexOf(_initial) !== -1 &&
                    SpecialFinalList.indexOf(_final) !== -1) {
                    // 针对 jqx 的 u 特殊处理
                    _final = SpecialFinalMap[_final];
                }
                initial_arr.push(_initial);
                final_arr.push(_final);
                break;
            }
        }
    }
    if (initialPattern === "standard") {
        initial_arr.forEach((initial, index) => {
            if (initial === "y" || initial === "w") {
                initial_arr[index] = "";
            }
        });
    }
    return {
        final: final_arr.join(" "),
        initial: initial_arr.join(" "), // 声母
    };
};
function getFinalPartsFromFinal(final) {
    let head = "", body = "", tail = "";
    if (doubleFinalList.indexOf(getPinyinWithoutTone(final)) !== -1) {
        head = final[0];
        body = final[1];
        tail = final.slice(2);
    }
    else {
        body = final[0] || "";
        tail = final.slice(1) || "";
    }
    return { head, body, tail };
}
const getFinalParts = (pinyin) => {
    const { final } = getInitialAndFinal(pinyin);
    return getFinalPartsFromFinal(final);
};
const getNumOfTone = (pinyin) => {
    const reg_tone1 = /(ā|ō|ē|ī|ū|ǖ|n̄|m̄|ê̄)/;
    const reg_tone2 = /(á|ó|é|í|ú|ǘ|ń|ḿ|ế)/;
    const reg_tone3 = /(ǎ|ǒ|ě|ǐ|ǔ|ǚ|ň|m̌|ê̌)/;
    const reg_tone4 = /(à|ò|è|ì|ù|ǜ|ǹ|m̀|ề)/;
    const reg_tone0 = /(a|o|e|i|u|ü|ê)/;
    const special_tone = /(n|m)$/;
    const tone_num_arr = [];
    const pinyin_arr = pinyin.split(" ");
    pinyin_arr.forEach((_pinyin) => {
        if (reg_tone1.test(_pinyin)) {
            tone_num_arr.push("1");
        }
        else if (reg_tone2.test(_pinyin)) {
            tone_num_arr.push("2");
        }
        else if (reg_tone3.test(_pinyin)) {
            tone_num_arr.push("3");
        }
        else if (reg_tone4.test(_pinyin)) {
            tone_num_arr.push("4");
        }
        else if (reg_tone0.test(_pinyin)) {
            tone_num_arr.push("0");
        }
        else if (special_tone.test(_pinyin)) {
            tone_num_arr.push("0");
        }
        else {
            tone_num_arr.push("");
        }
    });
    return tone_num_arr.join(" ");
};
const getPinyinWithNum = (pinyin, originPinyin) => {
    const pinyin_arr = getPinyinWithoutTone(pinyin).split(" ");
    const tone_num_arr = getNumOfTone(originPinyin).split(" ");
    const res_arr = [];
    pinyin_arr.forEach((item, index) => {
        res_arr.push(`${item}${tone_num_arr[index]}`);
    });
    return res_arr.join(" ");
};
const getFirstLetter = (pinyin, isZh) => {
    const first_letter_arr = [];
    const pinyin_arr = pinyin.split(" ");
    pinyin_arr.forEach((pinyin) => {
        first_letter_arr.push(isZh ? pinyin[0] : pinyin);
    });
    return first_letter_arr.join(" ");
};
// 处理「一」和 「不」字的变调
function processToneSandhi(cur, pre, next) {
    if (toneSandhiList.indexOf(cur) === -1) {
        return getSingleWordPinyin(cur);
    }
    // 轻声变调：说不说，说一说，叠词之间发音为轻声
    if (pre === next && pre && getSingleWordPinyin(pre) !== pre) {
        return getPinyinWithoutTone(getSingleWordPinyin(cur));
    }
    // 「一」和 「不」字变调处理
    if (next &&
        !toneSandhiIgnoreSuffix[cur].includes(next)) {
        const nextPinyin = getSingleWordPinyin(next);
        if (nextPinyin !== next) {
            const nextTone = getNumOfTone(nextPinyin);
            const pinyinMap = toneSandhiMap[cur];
            for (let pinyin in pinyinMap) {
                const tones = pinyinMap[pinyin];
                if (tones.indexOf(Number(nextTone)) !== -1) {
                    return pinyin;
                }
            }
        }
    }
}
// 处理「了」字的变调
function processToneSandhiLiao(cur, pre, _) {
    if (cur === "了" && (!pre || !DICT1.get(pre))) {
        return "liǎo";
    }
}
// 处理叠字符[々]
function processReduplicationChar(cur, pre, _) {
    if (cur === "々") {
        if (!pre || !DICT1.get(pre)) {
            return "tóng";
        }
        else {
            return DICT1.get(pre).split(" ")[0];
        }
    }
}
function getProcessFuncs(text) {
    const processes = [];
    if (text.includes("々")) {
        processes.push(processReduplicationChar);
    }
    processes.push(processToneSandhiLiao);
    processes.push(processToneSandhi);
    return processes;
}
function processSepecialPinyin(cur, pre, next, funcs) {
    for (let func of funcs) {
        const res = func(cur, pre, next);
        if (res) {
            return res;
        }
    }
    return getSingleWordPinyin(cur);
}

export { getFinalParts, getFinalPartsFromFinal, getFirstLetter, getInitialAndFinal, getMultiplePinyin, getNumOfTone, getPinyin, getPinyinWithNum, getPinyinWithoutTone, getSingleWordPinyin, processToneSandhi };
