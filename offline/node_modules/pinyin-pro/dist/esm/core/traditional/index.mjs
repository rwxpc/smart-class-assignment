const traditionalDict = [];
function addTraditionalDict(dict) {
    for (let key in dict) {
        const value = dict[key];
        const code = key.charCodeAt(0);
        traditionalDict[code] = value;
    }
}
function getTraditionalDict() {
    return traditionalDict;
}

export { addTraditionalDict, getTraditionalDict };
