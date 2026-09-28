import { ensureAcBuilt, acTree } from '../../common/segmentit/index.mjs';
import { Priority } from '../../common/constant.mjs';
import { stringLength, splitString } from '../../common/utils.mjs';
import DICT1 from '../../data/dict1.mjs';
import { customMultipleDict, customPolyphonicDict } from './state.mjs';

let customDict = {};
const CustomDictName = Symbol('custom');
/**
 * @description: 用户自定义拼音
 * @param {{ [key: string]: string }} config 用户自定义的拼音映射（支持汉字、词语、句子的映射），若匹配到该映射，优先将汉字转换为该映射
 * @param {CustomPinyinOptions} options multiple/polyphonic 对于 customPinyin 补充词汇的处理
 */
function customPinyin(config = {}, options) {
    ensureAcBuilt();
    const words = Object.keys(config).sort((word1, word2) => stringLength(word2) - stringLength(word1));
    words.forEach((word) => {
        customDict[word] = config[word];
    });
    const customPatterns = Object.keys(customDict).map((word) => ({
        zh: word,
        pinyin: customDict[word],
        probability: 1 /* Probability.Custom */ + stringLength(word),
        length: stringLength(word),
        priority: Priority.Custom,
        dict: CustomDictName,
    }));
    acTree.removeDict(CustomDictName);
    acTree.build(customPatterns);
    // add words for multiple and polyphonic
    if (options === null || options === void 0 ? void 0 : options.multiple) {
        addCustomConfigToDict(config, customMultipleDict, options.multiple);
    }
    if (options === null || options === void 0 ? void 0 : options.polyphonic) {
        addCustomConfigToDict(config, customPolyphonicDict, options.polyphonic);
    }
}
function addCustomConfigToDict(config, dict, handleType) {
    for (let word in config) {
        const pinyins = config[word];
        const pinyinList = pinyins.split(' ');
        splitString(word).forEach((char, index) => {
            const pinyin = pinyinList[index] || '';
            const current = dict.get(char);
            const base = current || DICT1.get(char);
            if (handleType === 'replace' || (handleType === 'add' && !base)) {
                // 直接覆盖原词典
                dict.set(char, pinyin);
            }
            else {
                // 补充至原词典
                const merged = base;
                if (!current) {
                    dict.set(char, merged);
                }
                if (!merged.split(' ').includes(pinyin)) {
                    dict.set(char, `${merged} ${pinyin}`.trim());
                }
            }
        });
    }
}
const getCustomPolyphonicDict = () => {
    return customPolyphonicDict;
};
function clearCustomDict(dict) {
    if (dict === 'pinyin' || dict.indexOf('pinyin') !== -1) {
        Object.keys(customDict).forEach(function (word) {
            delete customDict[word];
        });
        acTree.removeDict(CustomDictName);
    }
    if (dict === 'multiple' || dict.indexOf('multiple') !== -1) {
        customMultipleDict.clear();
    }
    if (dict === 'polyphonic' || dict.indexOf('polyphonic') !== -1) {
        customPolyphonicDict.clear();
    }
}

export { clearCustomDict, customPinyin, getCustomPolyphonicDict };
