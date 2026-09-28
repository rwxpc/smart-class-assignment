import { splitString } from '../../common/utils.mjs';
import { validateType, middlewareToneSandhi, middleWareNonZh, middlewareToneType, middlewareV } from '../pinyin/middlewares.mjs';
import { getPinyin } from '../pinyin/handle.mjs';
import { OutputFormat, middlewareSegment, middlewareOutputFormat } from './middlewares.mjs';
export { OutputFormat } from './middlewares.mjs';

const DEFAULT_OPTIONS = {
    toneType: "symbol",
    mode: "normal",
    nonZh: "spaced",
    v: false,
    separator: " ",
    toneSandhi: true,
    segmentit: 2 /* TokenizationAlgorithm.MaxProbability */,
    format: OutputFormat.AllSegment,
    traditional: false,
};
function segment(word, options) {
    options = Object.assign(Object.assign({}, DEFAULT_OPTIONS), (options || {}));
    // 校验 word 类型是否正确
    const legal = validateType(word);
    if (!legal) {
        return word;
    }
    if (options.surname === undefined) {
        if (options.mode === "surname") {
            options.surname = "all";
        }
        else {
            options.surname = "off";
        }
    }
    const zhChars = splitString(word);
    let _list = Array(zhChars.length);
    let { list, matches } = getPinyin(word, _list, options.surname, options.segmentit, options.traditional, zhChars);
    // 一和不变调处理
    list = middlewareToneSandhi(list, options.toneSandhi);
    // nonZh
    list = middleWareNonZh(list, options);
    // toneType参数处理
    middlewareToneType(list, options);
    // v参数处理
    middlewareV(list, options);
    const segments = middlewareSegment(list, matches);
    return middlewareOutputFormat(segments, { format: options.format, separator: options.separator });
}

export { segment };
