const tagRegex = /^\s*<\/?[^>]+>\s*$/;
const tagWordRegex = /<[^\s>]+/;
const whitespaceRegex = /^(\s|&nbsp;)+$/;
const wordRegex = /[\w\#@]+/;

const specialCaseWordTags = [
    '<img',
];

const FORMATTING_TAGS = new Set([
    'strong', 'b', 'i', 'dfn', 'em', 'big', 'small', 'u', 'sub', 'sup', 'strike', 's'
]);

const SEMANTIC_WRAPPER_TAGS = new Set([
    'eg-condition'
]);

const BLOCK_LEVEL_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'caption', 'col', 'colgroup', 'dd', 'div', 'dl', 'dt',
    'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
    'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
    'tr', 'ul'
]);

function isBlockLevelTag(word) {
    const tagName = getTagName(word);
    return tagName !== null && BLOCK_LEVEL_TAGS.has(tagName);
}

function canWrapWordsInDiffTag(words, start, end) {
    for (let i = start; i < end; i++) {
        if (isBlockLevelTag(words[i])) {
            return false;
        }
    }
    return true;
}

function markTagAttributeChange(tagWord) {
    if (/\sdata-diff=/.test(tagWord)) {
        return tagWord;
    }
    if (isSelfClosingTag(tagWord)) {
        return tagWord.replace(/\/>(\s*)$/, ' data-diff="attrmod" />$1');
    }
    if (isOpeningTag(tagWord)) {
        return tagWord.replace(/>(\s*)$/, ' data-diff="attrmod">$1');
    }
    return tagWord;
}

function isTag(item) {
    if (specialCaseWordTags.some(re => item !== null && item.startsWith(re))) {
        return false;
    }

    return tagRegex.test(item);
}

function stripTagAttributes(word) {
    let tag = tagWordRegex.exec(word)[0];
    word = tag + (word.endsWith("/>") ? "/>" : ">");
    return word;
}

function wrapText(text, tagName, cssClass) {
    return [
        '<', tagName, ' class="', cssClass, '">', text, '</', tagName, '>'
    ].join('');
}

function isStartOfTag(val) {
    return val === '<';
}

function isEndOfTag(val) {
    return val === '>';
}

function isStartOfEntity(val) {
    return val === '&';
}

function isEndOfEntity(val) {
    return val === ';';
}

function isWhiteSpace(value) {
    return whitespaceRegex.test(value);
}

function stripAnyAttributes(word) {
    if (isTag(word)) {
        return stripTagAttributes(word);
    }

    return word;
}

function isWord(text) {
    return wordRegex.test(text);
}

function getTagName(word) {
    if (!isTag(word)) {
        return null;
    }

    const match = word.match(/^<\/?([^\s>\/]+)/);
    return match ? match[1].toLowerCase() : null;
}

function isClosingTag(word) {
    return isTag(word) && /^\s*<\//.test(word);
}

function isSelfClosingTag(word) {
    return isTag(word) && !isClosingTag(word) && /\/>\s*$/.test(word);
}

function isOpeningTag(word) {
    return isTag(word) && !isClosingTag(word) && !isSelfClosingTag(word);
}

function findElementCloseIndex(words, openIndex) {
    const tagName = getTagName(words[openIndex]);
    if (!tagName) {
        return openIndex;
    }

    let depth = 1;
    for (let i = openIndex + 1; i < words.length; i++) {
        const word = words[i];
        if (!isTag(word)) {
            continue;
        }

        const wordTagName = getTagName(word);
        if (wordTagName !== tagName) {
            continue;
        }

        if (isClosingTag(word)) {
            depth--;
            if (depth === 0) {
                return i;
            }
        } else if (isOpeningTag(word)) {
            depth++;
        }
    }

    return openIndex;
}

function isAttributeOnlyTagDifference(oldWord, newWord) {
    return isTag(oldWord) &&
        isTag(newWord) &&
        oldWord !== newWord &&
        stripTagAttributes(oldWord) === stripTagAttributes(newWord);
}

function isFormattingOpeningTag(word) {
    if (!isOpeningTag(word)) {
        return false;
    }

    const tagName = getTagName(word);
    return tagName !== null && FORMATTING_TAGS.has(tagName);
}

function hasFormattingInWords(words) {
    return words.some(word => isFormattingOpeningTag(word));
}

function plainTextFromWords(words) {
    return words.filter(word => !isTag(word)).join('');
}

function wrapInnerFormattingContent(innerWords) {
    if (hasFormattingInWords(innerWords)) {
        let result = '';
        let i = 0;

        while (i < innerWords.length) {
            const word = innerWords[i];

            if (isFormattingOpeningTag(word)) {
                const closeIdx = findElementCloseIndex(innerWords, i);
                result += innerWords[i];
                result += wrapInnerFormattingContent(innerWords.slice(i + 1, closeIdx));
                result += innerWords[closeIdx];
                i = closeIdx + 1;
            } else {
                result += word;
                i++;
            }
        }

        return result;
    }

    const innerPlain = plainTextFromWords(innerWords);
    if (!innerPlain) {
        return '';
    }

    return wrapText(innerPlain, 'ins', 'format-change');
}

function renderFormatAdded(newWords) {
    let result = '';
    let i = 0;

    while (i < newWords.length) {
        const word = newWords[i];

        if (isFormattingOpeningTag(word)) {
            const closeIdx = findElementCloseIndex(newWords, i);
            result += newWords[i];
            result += wrapInnerFormattingContent(newWords.slice(i + 1, closeIdx));
            result += newWords[closeIdx];
            i = closeIdx + 1;
        } else {
            result += word;
            i++;
        }
    }

    return result;
}

function renderFormatRemoved(oldWords) {
    let result = '';
    let i = 0;

    while (i < oldWords.length) {
        const word = oldWords[i];

        if (isFormattingOpeningTag(word)) {
            const closeIdx = findElementCloseIndex(oldWords, i);
            const segment = oldWords.slice(i, closeIdx + 1).join('');
            result += wrapText(segment, 'del', 'format-change');
            i = closeIdx + 1;
        } else {
            result += word;
            i++;
        }
    }

    return result;
}

function isFormattingOnlyChange(oldWords, newWords) {
    if (plainTextFromWords(oldWords) !== plainTextFromWords(newWords)) {
        return false;
    }

    return hasFormattingInWords(oldWords) || hasFormattingInWords(newWords);
}

function isSemanticWrapperOpeningTag(word) {
    if (!isOpeningTag(word)) {
        return false;
    }

    const tagName = getTagName(word);
    return tagName !== null && SEMANTIC_WRAPPER_TAGS.has(tagName);
}

function isSemanticWrapperClosingTag(word) {
    if (!isClosingTag(word)) {
        return false;
    }

    const tagName = getTagName(word);
    return tagName !== null && SEMANTIC_WRAPPER_TAGS.has(tagName);
}

function hasSemanticWrapperInWords(words) {
    return words.some(word => isSemanticWrapperOpeningTag(word));
}

function renderWrapperAdded(newWords) {
    let result = '';
    let i = 0;

    while (i < newWords.length) {
        const word = newWords[i];

        if (isSemanticWrapperOpeningTag(word)) {
            const closeIdx = findElementCloseIndex(newWords, i);
            const segment = newWords.slice(i, closeIdx + 1).join('');
            result += wrapText(segment, 'ins', 'structure-change');
            i = closeIdx + 1;
        } else {
            result += word;
            i++;
        }
    }

    return result;
}

function renderWrapperRemoved(oldWords) {
    let result = '';
    let i = 0;

    while (i < oldWords.length) {
        const word = oldWords[i];

        if (isSemanticWrapperOpeningTag(word)) {
            const closeIdx = findElementCloseIndex(oldWords, i);
            const segment = oldWords.slice(i, closeIdx + 1).join('');
            result += wrapText(segment, 'del', 'structure-change');
            i = closeIdx + 1;
        } else {
            result += word;
            i++;
        }
    }

    return result;
}

function isWrapperOnlyChange(oldWords, newWords) {
    if (plainTextFromWords(oldWords) !== plainTextFromWords(newWords)) {
        return false;
    }

    if (oldWords.join('') === newWords.join('')) {
        return false;
    }

    return hasSemanticWrapperInWords(oldWords) || hasSemanticWrapperInWords(newWords);
}

function renderWrapperOnlyChange(oldWords, newWords) {
    const oldHasWrapper = hasSemanticWrapperInWords(oldWords);
    const newHasWrapper = hasSemanticWrapperInWords(newWords);

    if (newHasWrapper && !oldHasWrapper) {
        return renderWrapperAdded(newWords);
    }

    if (oldHasWrapper && !newHasWrapper) {
        return renderWrapperRemoved(oldWords);
    }

    if (newHasWrapper) {
        return renderWrapperAdded(newWords);
    }

    return newWords.join('');
}

function renderFormattingOnlyChange(oldWords, newWords) {
    const oldHasFormatting = hasFormattingInWords(oldWords);
    const newHasFormatting = hasFormattingInWords(newWords);

    if (newHasFormatting && !oldHasFormatting) {
        return renderFormatAdded(newWords);
    }

    if (oldHasFormatting && !newHasFormatting) {
        return renderFormatRemoved(oldWords);
    }

    if (newHasFormatting) {
        return renderFormatAdded(newWords);
    }

    return newWords.join('');
}

function wordsSliceEqual(oldWords, newWords, oldStart, oldEnd, newStart, newEnd) {
    const oldLen = oldEnd - oldStart;
    const newLen = newEnd - newStart;
    if (oldLen !== newLen) {
        return false;
    }

    for (let i = 0; i < oldLen; i++) {
        if (oldWords[oldStart + i] !== newWords[newStart + i]) {
            return false;
        }
    }

    return true;
}

export {
    isTag,
    stripTagAttributes,
    wrapText,
    isStartOfTag,
    isEndOfTag,
    isStartOfEntity,
    isEndOfEntity,
    isWhiteSpace,
    stripAnyAttributes,
    isWord,
    getTagName,
    isClosingTag,
    isSelfClosingTag,
    isOpeningTag,
    findElementCloseIndex,
    isAttributeOnlyTagDifference,
    isBlockLevelTag,
    canWrapWordsInDiffTag,
    markTagAttributeChange,
    wordsSliceEqual,
    isFormattingOpeningTag,
    hasFormattingInWords,
    plainTextFromWords,
    isFormattingOnlyChange,
    renderFormattingOnlyChange,
    isSemanticWrapperOpeningTag,
    isSemanticWrapperClosingTag,
    hasSemanticWrapperInWords,
    isWrapperOnlyChange,
    renderWrapperOnlyChange
};