import { Priority } from '../constant.mjs';

// 根据 probability 和 decimal 获取两个概率中最大的
function getMaxProbability(a, b) {
    if (!a) {
        return b;
    }
    if (a.decimal < b.decimal) {
        return a;
    }
    else if (a.decimal === b.decimal) {
        return a.probability > b.probability ? a : b;
    }
    else {
        return b;
    }
}
// probability 小于 1e-300 时，为防止小数溢出需要进位
function checkDecimal(prob) {
    if (prob.probability < 1e-300) {
        prob.probability *= 1e300;
        prob.decimal += 1;
    }
}
function getPatternDecimal(pattern) {
    if (pattern.priority === Priority.Custom) {
        return -(pattern.length * pattern.length * 100);
    }
    if (pattern.priority === Priority.Surname) {
        return -(pattern.length * pattern.length * 10);
    }
    return 0;
}
// 最大概率算法
function maxProbability(patterns, length) {
    const dp = [];
    const terminalDP = {
        probability: 1,
        decimal: 0,
        nextIndex: length,
    };
    let patternIndex = patterns.length - 1;
    let pattern = patterns[patternIndex];
    // 按照长度去除重叠词
    for (let i = length - 1; i >= 0; i--) {
        // suffix
        const suffixDP = i + 1 >= length ? terminalDP : dp[i + 1];
        const nextIndex = suffixDP.pattern ? i + 1 : suffixDP.nextIndex;
        while (pattern && pattern.index + pattern.length - 1 === i) {
            const startIndex = pattern.index;
            const curDP = {
                probability: pattern.probability * suffixDP.probability,
                decimal: suffixDP.decimal + getPatternDecimal(pattern),
                pattern,
                nextIndex,
            };
            checkDecimal(curDP);
            dp[startIndex] = getMaxProbability(dp[startIndex], curDP);
            pattern = patterns[--patternIndex];
        }
        // dp[i]
        const iDP = {
            probability: 1e-13 /* Probability.Unknown */ * suffixDP.probability,
            decimal: 0,
            nextIndex,
        };
        checkDecimal(iDP);
        dp[i] = getMaxProbability(dp[i], iDP);
    }
    const result = [];
    let index = 0;
    while (index < length) {
        const item = dp[index];
        if (item.pattern) {
            result.push(item.pattern);
        }
        index = item.nextIndex;
    }
    return result;
}

export { maxProbability };
