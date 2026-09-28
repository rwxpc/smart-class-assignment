import { validateType, middleWareNonZh, middlewarePattern, middlewareToneType, middlewareV } from '../pinyin/middlewares.mjs';
import DICT1 from '../../data/dict1.mjs';
import { getInitialAndFinal, getFinalParts, getFirstLetter, getNumOfTone } from '../pinyin/handle.mjs';
import { getCustomPolyphonicDict } from '../custom/index.mjs';
import { splitString } from '../../common/utils.mjs';

const DEFAULT_OPTIONS = {
    pattern: "pinyin",
    toneType: "symbol",
    type: "string",
    v: false,
    nonZh: "spaced",
};
/**
 * @description: 获取每个汉字的所有读音
 * @param {string} text 要转换的汉语字符串
 * @param {CompleteOptions=} options 配置项
 * @return {string[] | string[][] | AllData[][]} options.type 为 string 时，返回字符串数组，中间用空格隔开；为 array 时，返回二维拼音字符串数组；为 all 时返回二维全部信息的数组
 */
function polyphonic(text, options = DEFAULT_OPTIONS) {
    // 校验 text 类型是否正确
    const legal = validateType(text);
    if (!legal) {
        return [];
    }
    // 传入空字符串
    if (text === "") {
        return [];
    }
    if (options.type === "all") {
        options.pattern = "pinyin";
    }
    if (options.pattern === "num") {
        options.toneType = "none";
    }
    if (options.removeNonZh) {
        options.nonZh = "removed";
    }
    let list = getPolyphonicList(text);
    // nonZh 参数及 removeNonZh 参数
    list = middleWareNonZh(list, options);
    const doubleList = getSplittedPolyphonicList(list);
    const result = [];
    for (const itemList of doubleList) {
        middlewarePattern(itemList, options);
        middlewareToneType(itemList, options);
        middlewareV(itemList, options);
        result.push(handleType(itemList, options));
    }
    return result;
}
// 获取每个字多音字的数组
const getPolyphonicList = (text) => {
    const customPolyphonicDict = getCustomPolyphonicDict();
    return splitString(text).map((char) => {
        const pinyin = customPolyphonicDict.get(char) || DICT1.get(char) || char;
        return {
            origin: char,
            result: pinyin,
            isZh: pinyin !== char,
            originPinyin: pinyin,
        };
    });
};
// 将多音字每个读音都单独切为一个数组项
const getSplittedPolyphonicList = (list) => {
    return list.map((item) => {
        if (!item.isZh) {
            return [item];
        }
        if (!item.result.includes(" ")) {
            return [
                {
                    origin: item.origin,
                    result: item.result,
                    isZh: true,
                    originPinyin: item.result,
                },
            ];
        }
        return item.result.split(" ").map((pinyin) => ({
            origin: item.origin,
            result: pinyin,
            isZh: true,
            originPinyin: pinyin,
        }));
    });
};
// type 属性处理
const handleType = (list, options) => {
    if (options.type !== "all") {
        const result = new Set();
        for (const item of list) {
            result.add(item.result);
        }
        const values = Array.from(result);
        return options.type === "array" ? values : values.join(" ");
    }
    const result = [];
    for (const item of list) {
        const pinyin = item.isZh ? item.result : "";
        const { initial, final } = getInitialAndFinal(pinyin, options.initialPattern);
        const { head, body, tail } = getFinalParts(pinyin);
        result.push({
            origin: item.origin,
            pinyin,
            initial,
            final,
            first: getFirstLetter(item.result, item.isZh),
            finalHead: head,
            finalBody: body,
            finalTail: tail,
            num: Number(getNumOfTone(item.originPinyin)),
            isZh: item.isZh,
            inZhRange: !!DICT1.get(item.origin),
        });
    }
    return result;
};

export { handleType, polyphonic };
