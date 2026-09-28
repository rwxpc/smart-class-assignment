import { PatternNumberDict } from './special.mjs';
import { Pattern2 } from './dict2.mjs';
import { Pattern3 } from './dict3.mjs';
import { Pattern4 } from './dict4.mjs';
import { Pattern5 } from './dict5.mjs';
import { PatternSurname } from './surname.mjs';

const PatternsNormal = [
    ...Pattern5,
    ...Pattern4,
    ...Pattern3,
    ...Pattern2,
    ...PatternNumberDict,
    ...PatternSurname,
];

export { PatternsNormal };
