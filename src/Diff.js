import Action from './Action';
import Match from './Match';
import MatchFinder from './MatchFinder';
import Operation from './Operation';
import MatchOptions from './MatchOptions';
import * as WordSplitter from './WordSplitter';
import * as Utils from './Utils';

// This value defines balance between speed and memory utilization. The higher it is the faster it works and more memory consumes.
const MatchGranuarityMaximum = 4;

class HtmlDiff {
    constructor(oldText, newText, splitBy) {
        this.content = [];
        this.newText = newText;
        this.oldText = oldText;

        this.splitBy = splitBy;

        this.specialTagDiffStack = [];
        this.newWords = [];
        this.oldWords = [];
        this.matchGranularity = 0;
        this.blockExpressions = [];

        this.repeatingWordsAccuracy = 1.0;
        this.ignoreWhiteSpaceDifferences = false;
        this.orphanMatchThreshold = 0.0;
    }

    build() {
        if (this.oldText === this.newText) {
            return this.newText;
        }

        this.splitInputsIntoWords();

        this.matchGranularity = Math.min(MatchGranuarityMaximum, this.oldWords.length, this.newWords.length);
        let operations = this.coalesceWrapperOperations(this.operations());

        for (let item of operations) {
            this.performOperation(item);
        }

        return this.content.join('');
    }

    addBlockExpression(exp) {
        this.blockExpressions.push(exp);
    }

    splitInputsIntoWords() {
        if (this.splitBy === "element") {
            this.oldWords = WordSplitter.splitHtmlIntoSmallestSegments(this.oldText);

            //free memory, allow it for GC
            this.oldText = null;

            this.newWords = WordSplitter.splitHtmlIntoSmallestSegments(this.newText);

            //free memory, allow it for GC
            this.newText = null;
        } else {
            this.oldWords = WordSplitter.convertHtmlToListOfWords(this.oldText, this.blockExpressions);

            //free memory, allow it for GC
            this.oldText = null;

            this.newWords = WordSplitter.convertHtmlToListOfWords(this.newText, this.blockExpressions);

            //free memory, allow it for GC
            this.newText = null;
        }
    }

    performOperation(opp) {
        switch (opp.action) {
            case Action.equal:
                this.processEqualOperation(opp);
                break;
            case Action.delete:
                this.processDeleteOperation(opp, "diffdel");
                break;
            case Action.insert:
                this.processInsertOperation(opp, "diffins");
                break;
            case Action.none:
                break;
            case Action.replace:
                this.processReplaceOperation(opp);
                break;
        }
    }

    processReplaceOperation(opp) {
        const oldWords = this.oldWords.slice(opp.startInOld, opp.endInOld);
        const newWords = this.newWords.slice(opp.startInNew, opp.endInNew);

        if (Utils.isWrapperOnlyChange(oldWords, newWords)) {
            this.content.push(Utils.renderWrapperOnlyChange(oldWords, newWords));
            return;
        }

        if (Utils.isFormattingOnlyChange(oldWords, newWords)) {
            this.content.push(Utils.renderFormattingOnlyChange(oldWords, newWords));
            return;
        }

        this.processDeleteOperation(opp, "diffmod");
        this.processInsertOperation(opp, "diffmod");
    }

    processInsertOperation(opp, cssClass) {
        let text = this.newWords.filter((s, pos) => pos >= opp.startInNew && pos < opp.endInNew);
        this.insertTag("ins", cssClass, text);
    }

    processDeleteOperation(opp, cssClass) {
        let text = this.oldWords.filter((s, pos) => pos >= opp.startInOld && pos < opp.endInOld);
        this.insertTag("del", cssClass, text);
    }

    processEqualOperation(opp) {
        const length = opp.endInNew - opp.startInNew;
        let i = 0;

        while (i < length) {
            const oldWord = this.oldWords[opp.startInOld + i];
            const newWord = this.newWords[opp.startInNew + i];

            if (oldWord === newWord) {
                this.content.push(newWord);
                i++;
                continue;
            }

            if (Utils.isAttributeOnlyTagDifference(oldWord, newWord)) {
                if (Utils.isSelfClosingTag(newWord)) {
                    if (!Utils.isBlockLevelTag(newWord)) {
                        this.content.push(Utils.wrapText(newWord, 'ins', 'diffmod'));
                        i++;
                        continue;
                    }
                    this.content.push(Utils.markTagAttributeChange(newWord));
                    i++;
                    continue;
                }

                if (Utils.isOpeningTag(newWord)) {
                    const oldOpenIdx = opp.startInOld + i;
                    const newOpenIdx = opp.startInNew + i;
                    const oldCloseIdx = Utils.findElementCloseIndex(this.oldWords, oldOpenIdx);
                    const newCloseIdx = Utils.findElementCloseIndex(this.newWords, newOpenIdx);
                    const oldCloseRel = oldCloseIdx - oldOpenIdx;
                    const newCloseRel = newCloseIdx - newOpenIdx;

                    if (oldCloseRel === newCloseRel && oldCloseRel > 0 &&
                        !Utils.isBlockLevelTag(newWord) &&
                        Utils.canWrapWordsInDiffTag(this.newWords, newOpenIdx + 1, newCloseIdx) &&
                        Utils.wordsSliceEqual(
                            this.oldWords,
                            this.newWords,
                            oldOpenIdx + 1,
                            oldCloseIdx,
                            newOpenIdx + 1,
                            newCloseIdx
                        )) {
                        const newSubtree = this.newWords.slice(newOpenIdx, newCloseIdx + 1);
                        this.content.push(Utils.wrapText(newSubtree.join(''), 'ins', 'diffmod'));
                        i += newCloseRel + 1;
                        continue;
                    }
                }

                this.content.push(Utils.markTagAttributeChange(newWord));
                i++;
                continue;
            }

            this.content.push(
                Utils.wrapText(oldWord, 'del', 'diffmod'),
                Utils.wrapText(newWord, 'ins', 'diffmod')
            );
            i++;
        }
    }

    insertTag(tag, cssClass, words) {
        this.specialTagDiffStack = [];
        const modOpen = tag === 'del' ? '<del class="mod">' : '<ins class="mod">';
        const modClose = tag === 'del' ? '</del>' : '</ins>';

        while (words.length) {
            let nonTags = this.extractConsecutiveWords(words, x => !Utils.isTag(x));

            if (nonTags.length !== 0) {
                let text = Utils.wrapText(nonTags.join(''), tag, cssClass);
                this.content.push(text);
                continue;
            }

            const tagWords = this.extractConsecutiveWords(words, Utils.isTag);

            if (tagWords.length === 0) {
                break;
            }

            this.content.push(tag === 'del' ? tagWords.join('') : this.renderTagRun(tagWords, modOpen, modClose));
        }

        // A formatting element can start inside this operation and end in another one.
        // Close the wrappers we opened so the output stays balanced.
        if (this.specialTagDiffStack.length !== 0) {
            this.content.push(modClose.repeat(this.specialTagDiffStack.length));
            this.specialTagDiffStack = [];
        }
    }

    renderTagRun(tagWords, modOpen, modClose) {
        let result = '';

        for (const word of tagWords) {
            if (Utils.isFormattingOpeningTag(word)) {
                this.specialTagDiffStack.push(Utils.getTagName(word));
                result += word + modOpen;
                continue;
            }

            const stackTop = this.specialTagDiffStack.length === 0
                ? null
                : this.specialTagDiffStack[this.specialTagDiffStack.length - 1];

            if (Utils.isFormattingClosingTag(word) && stackTop === Utils.getTagName(word)) {
                this.specialTagDiffStack.pop();
                result += modClose + word;
                continue;
            }

            result += word;
        }

        return result;
    }

    extractConsecutiveWords(words, condition) {
        let indexOfFirstTag = null;

        for (let i = 0; i < words.length; i++) {
            let word = words[i];

            if (i === 0 && word === ' ') {
                words[i] = '&nbsp;';
            }

            if (!condition(word)) {
                indexOfFirstTag = i;
                break;
            }
        }

        if (indexOfFirstTag !== null) {
            let items = words.filter((s, pos) => pos >= 0 && pos < indexOfFirstTag);
            if (indexOfFirstTag > 0) {
                words.splice(0, indexOfFirstTag);
            }

            return items;
        } else {
            let items = words.filter((s, pos) => pos >= 0 && pos < words.length);
            words.splice(0, words.length);
            return items;
        }
    }

    coalesceWrapperOperations(operations) {
        const result = [];
        let i = 0;

        while (i < operations.length) {
            const coalescedInsert = this.tryCoalesceWrapperInsert(operations, i);
            if (coalescedInsert) {
                result.push(coalescedInsert.operation);
                i = coalescedInsert.nextIndex;
                continue;
            }

            const coalescedDelete = this.tryCoalesceWrapperRemove(operations, i);
            if (coalescedDelete) {
                result.push(coalescedDelete.operation);
                i = coalescedDelete.nextIndex;
                continue;
            }

            result.push(operations[i]);
            i++;
        }

        return result;
    }

    tryCoalesceWrapperInsert(operations, index) {
        if (index + 2 >= operations.length) {
            return null;
        }

        const insertOpen = operations[index];
        const equalOp = operations[index + 1];
        const insertClose = operations[index + 2];

        if (insertOpen.action !== Action.insert ||
            equalOp.action !== Action.equal ||
            insertClose.action !== Action.insert) {
            return null;
        }

        const openWords = this.newWords.slice(insertOpen.startInNew, insertOpen.endInNew);
        const closeWords = this.newWords.slice(insertClose.startInNew, insertClose.endInNew);

        if (openWords.length !== 1 || closeWords.length !== 1) {
            return null;
        }

        if (!Utils.isCoalescableOpeningTag(openWords[0]) ||
            !Utils.isCoalescableClosingTag(closeWords[0])) {
            return null;
        }

        if (Utils.getTagName(openWords[0]) !== Utils.getTagName(closeWords[0])) {
            return null;
        }

        const wrapperOpenIdx = insertOpen.startInNew;
        const wrapperCloseIdx = insertClose.startInNew;
        const expectedCloseIdx = Utils.findElementCloseIndex(this.newWords, wrapperOpenIdx);

        if (expectedCloseIdx !== wrapperCloseIdx) {
            return null;
        }

        if (equalOp.startInNew !== wrapperOpenIdx + 1 || equalOp.endInNew !== wrapperCloseIdx) {
            return null;
        }

        const oldEqualWords = this.oldWords.slice(equalOp.startInOld, equalOp.endInOld);
        const newInnerWords = this.newWords.slice(equalOp.startInNew, equalOp.endInNew);

        if (oldEqualWords.some(word => Utils.isTag(word))) {
            return null;
        }

        if (Utils.plainTextFromWords(oldEqualWords) !== Utils.plainTextFromWords(newInnerWords)) {
            return null;
        }

        return {
            operation: new Operation(
                Action.replace,
                equalOp.startInOld,
                equalOp.endInOld,
                wrapperOpenIdx,
                expectedCloseIdx + 1
            ),
            nextIndex: index + 3
        };
    }

    tryCoalesceWrapperRemove(operations, index) {
        if (index + 2 >= operations.length) {
            return null;
        }

        const deleteOpen = operations[index];
        const equalOp = operations[index + 1];
        const deleteClose = operations[index + 2];

        if (deleteOpen.action !== Action.delete ||
            equalOp.action !== Action.equal ||
            deleteClose.action !== Action.delete) {
            return null;
        }

        const openWords = this.oldWords.slice(deleteOpen.startInOld, deleteOpen.endInOld);
        const closeWords = this.oldWords.slice(deleteClose.startInOld, deleteClose.endInOld);

        if (openWords.length !== 1 || closeWords.length !== 1) {
            return null;
        }

        if (!Utils.isCoalescableOpeningTag(openWords[0]) ||
            !Utils.isCoalescableClosingTag(closeWords[0])) {
            return null;
        }

        if (Utils.getTagName(openWords[0]) !== Utils.getTagName(closeWords[0])) {
            return null;
        }

        const wrapperOpenIdx = deleteOpen.startInOld;
        const wrapperCloseIdx = deleteClose.startInOld;
        const expectedCloseIdx = Utils.findElementCloseIndex(this.oldWords, wrapperOpenIdx);

        if (expectedCloseIdx !== wrapperCloseIdx) {
            return null;
        }

        if (equalOp.startInOld !== wrapperOpenIdx + 1 || equalOp.endInOld !== wrapperCloseIdx) {
            return null;
        }

        const newEqualWords = this.newWords.slice(equalOp.startInNew, equalOp.endInNew);
        const oldInnerWords = this.oldWords.slice(equalOp.startInOld, equalOp.endInOld);

        if (newEqualWords.some(word => Utils.isTag(word))) {
            return null;
        }

        if (Utils.plainTextFromWords(oldInnerWords) !== Utils.plainTextFromWords(newEqualWords)) {
            return null;
        }

        return {
            operation: new Operation(
                Action.replace,
                wrapperOpenIdx,
                expectedCloseIdx + 1,
                equalOp.startInNew,
                equalOp.endInNew
            ),
            nextIndex: index + 3
        };
    }

    operations() {
        let positionInOld = 0;
        let positionInNew = 0;
        let operations = [];

        let matches = this.matchingBlocks();
        matches.push(new Match(this.oldWords.length, this.newWords.length, 0));

        let matchesWithoutOrphans = this.removeOrphans(matches);

        for (let match of matchesWithoutOrphans) {
            let matchStartsAtCurrentPositionInOld = positionInOld === match.startInOld;
            let matchStartsAtCurrentPositionInNew = positionInNew === match.startInNew;

            let action;

            if (!matchStartsAtCurrentPositionInOld && !matchStartsAtCurrentPositionInNew) {
                action = Action.replace;
            } else if (matchStartsAtCurrentPositionInOld && !matchStartsAtCurrentPositionInNew) {
                action = Action.insert;
            } else if (!matchStartsAtCurrentPositionInOld) {
                action = Action.delete;
            } else {
                action = Action.none;
            }

            if (action !== Action.none) {
                operations.push(new Operation(action, positionInOld, match.startInOld, positionInNew, match.startInNew));
            }

            if (match.length !== 0) {
                operations.push(new Operation(Action.equal, match.startInOld, match.endInOld, match.startInNew, match.endInNew));
            }

            positionInOld = match.endInOld;
            positionInNew = match.endInNew;
        }

        return operations;
    }

    * removeOrphans(matches) {
        let prev = null;
        let curr = null;

        for (let next of matches) {
            if (curr === null) {
                prev = new Match(0, 0, 0);
                curr = next;
                continue;
            }

            if (prev.endInOld === curr.startInOld && prev.endInNew === curr.startInNew ||
                curr.endInOld === next.startInOld && curr.endInNew === next.startInNew) {
                yield curr;
                let tmp = prev = curr; // "let tmp" avoids babel traspiling error
                curr = next;
                continue;
            }

            let sumLength = (t, n) => t + n.length;

            let oldDistanceInChars = this.oldWords.slice(prev.endInOld, next.startInOld).reduce(sumLength, 0);
            let newDistanceInChars = this.newWords.slice(prev.endInNew, next.startInNew).reduce(sumLength, 0);
            let currMatchLengthInChars = this.newWords.slice(curr.startInNew, curr.endInNew).reduce(sumLength, 0);
            if (currMatchLengthInChars > Math.max(oldDistanceInChars, newDistanceInChars) * this.orphanMatchThreshold) {
                yield curr;
            }

            prev = curr;
            curr = next;
        }

        yield curr;
    }

    matchingBlocks() {
        let matchingBlocks = [];
        this.findMatchingBlocks(0, this.oldWords.length, 0, this.newWords.length, matchingBlocks);
        return matchingBlocks;
    }

    findMatchingBlocks(startInOld, endInOld, startInNew, endInNew, matchingBlocks) {
        let match = this.findMatch(startInOld, endInOld, startInNew, endInNew);

        if (match !== null) {
            if (startInOld < match.startInOld && startInNew < match.startInNew) {
                this.findMatchingBlocks(startInOld, match.startInOld, startInNew, match.startInNew, matchingBlocks);
            }

            matchingBlocks.push(match);

            if (match.endInOld < endInOld && match.endInNew < endInNew) {
                this.findMatchingBlocks(match.endInOld, endInOld, match.endInNew, endInNew, matchingBlocks);
            }
        }
    }

    findMatch(startInOld, endInOld, startInNew, endInNew) {
        for (let i = this.matchGranularity; i > 0; i--) {
            let options = new MatchOptions();
            options.blockSize = i;
            options.repeatingWordsAccuracy = this.repeatingWordsAccuracy;
            options.ignoreWhitespaceDifferences = this.ignoreWhiteSpaceDifferences;

            let finder = new MatchFinder(this.oldWords, this.newWords, startInOld, endInOld, startInNew, endInNew, options);
            let match = finder.findMatch();
            if (match !== null) {
                return match;
            }
        }

        return null;
    }
}

HtmlDiff.execute = function (oldText, newText, splitBy = "word") {
    return new HtmlDiff(oldText, newText, splitBy).build();
};

export default HtmlDiff;
