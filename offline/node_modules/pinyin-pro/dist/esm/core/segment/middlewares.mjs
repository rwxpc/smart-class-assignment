import { splitString } from '../../common/utils.mjs';

var OutputFormat;
(function (OutputFormat) {
    OutputFormat[OutputFormat["AllSegment"] = 1] = "AllSegment";
    OutputFormat[OutputFormat["AllArray"] = 2] = "AllArray";
    OutputFormat[OutputFormat["AllString"] = 3] = "AllString";
    OutputFormat[OutputFormat["PinyinSegment"] = 4] = "PinyinSegment";
    OutputFormat[OutputFormat["PinyinArray"] = 5] = "PinyinArray";
    OutputFormat[OutputFormat["PinyinString"] = 6] = "PinyinString";
    OutputFormat[OutputFormat["ZhSegment"] = 7] = "ZhSegment";
    OutputFormat[OutputFormat["ZhArray"] = 8] = "ZhArray";
    OutputFormat[OutputFormat["ZhString"] = 9] = "ZhString";
})(OutputFormat || (OutputFormat = {}));
function middlewareSegment(list, matches) {
    const segments = [];
    let i = 0;
    let j = 0;
    while (i < list.length && j < matches.length) {
        const match = matches[j];
        const item = list[i];
        if (match.zh.startsWith(item.origin)) {
            const start = i;
            const chars = splitString(match.zh);
            let cur = start + 1;
            while (cur < list.length && list[cur].origin === chars[cur - start]) {
                cur++;
            }
            const _segment = list.slice(start, cur);
            segments.push({
                segment: _segment.map((item) => ({
                    origin: item.origin,
                    result: item.result,
                })),
                isZh: true,
            });
            i += cur - start;
            j++;
        }
        else {
            segments.push({
                segment: [
                    {
                        origin: item.origin,
                        result: item.result,
                    }
                ],
                isZh: false,
            });
            i++;
        }
    }
    while (i < list.length) {
        const item = list[i];
        segments.push({
            segment: [
                {
                    origin: item.origin,
                    result: item.result,
                }
            ],
            isZh: false,
        });
        i++;
    }
    return segments;
}
function middlewareOutputFormat(segments, options) {
    const { format = OutputFormat.AllSegment, separator = ' ' } = options;
    if (format === OutputFormat.AllSegment) {
        return segments.map(item => {
            return {
                origin: item.segment.map(item => item.origin).join(''),
                result: item.segment.map(item => item.result).join(''),
            };
        });
    }
    else if (format === OutputFormat.AllArray) {
        return segments.map(item => item.segment);
    }
    else if (format === OutputFormat.AllString) {
        const list = segments.map(item => {
            return {
                origin: item.segment.map(item => item.origin).join(''),
                result: item.segment.map(item => item.result).join(''),
            };
        });
        return {
            origin: list.map(item => item.origin).join(separator),
            result: list.map(item => item.result).join(separator),
        };
    }
    else if (format === OutputFormat.PinyinSegment) {
        return segments.map(item => item.segment.map(item => item.result).join(''));
    }
    else if (format === OutputFormat.PinyinArray) {
        return segments.map(item => item.segment.map(item => item.result));
    }
    else if (format === OutputFormat.PinyinString) {
        return segments.map(item => item.segment.map(item => item.result).join('')).join(separator);
    }
    else if (format === OutputFormat.ZhSegment) {
        return segments.map(item => item.segment.map(item => item.origin).join(''));
    }
    else if (format === OutputFormat.ZhArray) {
        return segments.map(item => item.segment.map(item => item.origin));
    }
    else if (format === OutputFormat.ZhString) {
        return segments.map(item => item.segment.map(item => item.origin).join('')).join(separator);
    }
}

export { OutputFormat, middlewareOutputFormat, middlewareSegment };
