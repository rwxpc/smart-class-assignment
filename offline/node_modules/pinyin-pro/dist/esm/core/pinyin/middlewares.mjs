import { stringLength } from '../../common/utils.mjs';
import { getMultiplePinyin, getFinalParts, getFirstLetter, getInitialAndFinal, getNumOfTone, getPinyinWithNum, getPinyinWithoutTone, getFinalPartsFromFinal } from './handle.mjs';
import DICT1 from '../../data/dict1.mjs';
import { getAllPinyin } from './all.mjs';

// 验证输入是否为字符串
const validateType = (word) => {
    if (typeof word !== "string") {
        console.error("The first param of pinyin is error: " +
            word +
            ' is not assignable to type "string".');
        return false;
    }
    else {
        return true;
    }
};
function isNonZhScope(char, scope) {
    if (scope instanceof RegExp) {
        // Global and sticky regexes retain lastIndex between calls.
        if (scope.global || scope.sticky) {
            scope.lastIndex = 0;
        }
        return scope.test(char);
    }
    return true;
}
// nonZh 属性处理
const middleWareNonZh = (list, options) => {
    let nonZh = options.nonZh;
    if (nonZh === "removed") {
        return list.filter((item) => item.isZh || !isNonZhScope(item.origin, options.nonZhScope));
    }
    else if (nonZh === "consecutive") {
        for (let i = list.length - 2; i >= 0; i--) {
            const cur = list[i];
            const pre = list[i + 1];
            if (!cur.isZh &&
                !pre.isZh &&
                isNonZhScope(cur.origin, options.nonZhScope) &&
                isNonZhScope(pre.origin, options.nonZhScope)) {
                cur.origin += pre.origin;
                cur.result += pre.result;
                pre.delete = true;
            }
        }
        return list.filter((item) => !item.delete);
    }
    else {
        return list;
    }
};
// multiple 属性处理
const middlewareMultiple = (word, options) => {
    if (options.multiple && stringLength(word) === 1) {
        return getMultiplePinyin(word, options.surname);
    }
    else {
        return false;
    }
};
// pattern 属性处理
const middlewarePattern = (list, options) => {
    switch (options.pattern) {
        case "pinyin":
            break;
        case "num":
            list.forEach((item) => {
                item.result = item.isZh ? getNumOfTone(item.result) : "";
            });
            break;
        case "initial":
            list.forEach((item) => {
                item.result = item.isZh
                    ? getInitialAndFinal(item.result, options.initialPattern).initial
                    : "";
            });
            break;
        case "final":
            list.forEach((item) => {
                item.result = item.isZh
                    ? getInitialAndFinal(item.result, options.initialPattern).final
                    : "";
            });
            break;
        case "first":
            list.forEach((item) => {
                item.result = getFirstLetter(item.result, item.isZh);
            });
            break;
        case "finalHead":
            list.forEach((item) => {
                item.result = item.isZh ? getFinalParts(item.result).head : "";
            });
            break;
        case "finalBody":
            list.forEach((item) => {
                item.result = item.isZh ? getFinalParts(item.result).body : "";
            });
            break;
        case "finalTail":
            list.forEach((item) => {
                item.result = item.isZh ? getFinalParts(item.result).tail : "";
            });
            break;
    }
};
// toneType 属性处理
const middlewareToneType = (list, options) => {
    switch (options.toneType) {
        case "symbol":
            break;
        case "none":
            list.forEach((item) => {
                if (item.isZh) {
                    item.result = getPinyinWithoutTone(item.result);
                }
            });
            break;
        case "num": {
            list.forEach((item) => {
                if (item.isZh) {
                    item.result = getPinyinWithNum(item.result, item.originPinyin);
                }
            });
            break;
        }
    }
};
// v 属性处理
const middlewareV = (list, options) => {
    if (options.v) {
        list.forEach((item) => {
            if (item.isZh) {
                item.result = item.result.replace(/ü/g, typeof options.v === "string" ? options.v : "v");
            }
        });
    }
};
// type 属性处理
const middlewareType = (list, options, word) => {
    if (options.multiple && stringLength(word) === 1) {
        let last = "";
        list = list.filter((item) => {
            const res = item.result !== last;
            last = item.result;
            return res;
        });
    }
    if (options.type === "array") {
        return list.map((item) => item.result);
    }
    if (options.type === "all") {
        return list.map((item) => {
            const pinyin = item.isZh ? item.result : "";
            const { initial, final } = getInitialAndFinal(pinyin, options.initialPattern);
            const { head, body, tail } = getFinalPartsFromFinal(final);
            let polyphonic = [];
            if (pinyin !== "") {
                polyphonic = [pinyin].concat(getAllPinyin(item.origin, options.surname).filter((item) => item !== pinyin));
            }
            return {
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
                polyphonic,
                inZhRange: !!DICT1.get(item.origin),
                result: item.result,
            };
        });
    }
    return list.map((item) => item.result).join(options.separator);
};
// 是否开启变调
const middlewareToneSandhi = (list, toneSandhi) => {
    if (toneSandhi === false) {
        list.forEach((item) => {
            if (item.origin === "一") {
                item.result = item.originPinyin = "yī";
            }
            else if (item.origin === "不") {
                item.result = item.originPinyin = "bù";
            }
        });
    }
    return list;
};

export { isNonZhScope, middleWareNonZh, middlewareMultiple, middlewarePattern, middlewareToneSandhi, middlewareToneType, middlewareType, middlewareV, validateType };
