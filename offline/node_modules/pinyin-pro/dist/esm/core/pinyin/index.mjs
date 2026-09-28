import { splitString } from '../../common/utils.mjs';
import { getPinyin } from './handle.mjs';
import { validateType, middlewareToneSandhi, middleWareNonZh, middlewareMultiple, middlewarePattern, middlewareToneType, middlewareV, middlewareType } from './middlewares.mjs';

const DEFAULT_OPTIONS = {
    pattern: "pinyin",
    toneType: "symbol",
    type: "string",
    multiple: false,
    mode: "normal",
    removeNonZh: false,
    nonZh: "spaced",
    v: false,
    separator: " ",
    toneSandhi: true,
    segmentit: 2 /* TokenizationAlgorithm.MaxProbability */,
};
/**
 * @description: 获取汉语字符串的拼音
 * @param {string} word 要转换的汉语字符串
 * @param {CompleteOptions=} options 配置项
 * @return {string | string[] | AllData[]} options.type 为 string 时，返回字符串，中间用空格隔开；为 array 时，返回拼音字符串数组；为 all 时返回全部信息的数组
 */
function pinyin(word, options) {
    options = Object.assign(Object.assign({}, DEFAULT_OPTIONS), (options || {}));
    // 校验 word 类型是否正确
    const legal = validateType(word);
    if (!legal) {
        return word;
    }
    // 传入空字符串
    if (word === "") {
        return options.type === "array" || options.type === "all" ? [] : "";
    }
    if (options.surname === undefined) {
        if (options.mode === "surname") {
            options.surname = "all";
        }
        else {
            options.surname = "off";
        }
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
    const zhChars = splitString(word);
    let _list = Array(zhChars.length);
    let { list } = getPinyin(word, _list, options.surname, options.segmentit, options.traditional, zhChars);
    // 一和不变调处理
    list = middlewareToneSandhi(list, options.toneSandhi);
    // nonZh 参数及 removeNonZh 参数
    list = middleWareNonZh(list, options);
    // multiple 参数
    const multipleList = middlewareMultiple(word, options);
    if (multipleList) {
        list = multipleList;
    }
    // pattern 参数
    middlewarePattern(list, options);
    // toneType参数处理
    middlewareToneType(list, options);
    // v参数处理
    middlewareV(list, options);
    // type 参数处理
    return middlewareType(list, options, word);
}

export { pinyin };
