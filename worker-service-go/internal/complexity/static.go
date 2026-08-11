// Package complexity computes a deterministic time/space complexity estimate
// for a submission by statically analyzing the user's OWN submitted source
// code (loop nesting, recursion, sort calls, sized allocations) - no LLM, no
// external dependency, and no dependence on how many test cases a problem
// has or how similar their input sizes are.
//
// An earlier version of this package estimated complexity empirically (a
// log-log regression of wall-time/memory against input size across a
// submission's test cases). That approach degraded to "insufficient data"
// for the overwhelming majority of real submissions, since most judged
// problems only have a handful of test cases with little size variation -
// nowhere near enough distinct points for a regression to mean anything.
// Static structural analysis always produces an answer instead, at the cost
// of being a heuristic rather than a measurement.
//
// This is intentionally separate from, and runs independently of,
// ai-analysis-service's own LLM-derived complexity guess.
package complexity

import (
	"regexp"
	"strings"
)

// EstimateStatic analyzes rawCode (the user's original submission, NOT the
// harness-glued version that actually gets executed - see
// domain.SubmissionJob.RawCode) and returns Big-O labels for time and space
// complexity.
func EstimateStatic(rawCode string, language string) (timeComplexity string, spaceComplexity string) {
	code := stripCommentsAndStrings(rawCode, language)

	var maxLoopNesting int
	var hasHalvingLoop bool
	if language == "python" {
		maxLoopNesting, hasHalvingLoop = analyzeLoopNestingPython(code)
	} else {
		maxLoopNesting, hasHalvingLoop = analyzeLoopNestingBraces(code)
	}

	selfCallCount := countSelfRecursiveCalls(code, language)
	hasSort := sortCallPattern.MatchString(code)
	hasSizedAllocation := sizedAllocationPattern.MatchString(code)

	timeComplexity = classifyTime(maxLoopNesting, hasHalvingLoop, selfCallCount, hasSort)
	spaceComplexity = classifySpace(selfCallCount, hasSizedAllocation)
	return
}

// --------------------------------------------------------------------------
// comment/string stripping - reduces false positives from keywords that
// appear inside string literals or comments rather than real code.
// --------------------------------------------------------------------------

var (
	tripleQuotePattern      = regexp.MustCompile(`(?s)""".*?"""|'''.*?'''`)
	blockCommentPattern     = regexp.MustCompile(`(?s)/\*.*?\*/`)
	lineCommentSlashPattern = regexp.MustCompile(`//[^\n]*`)
	lineCommentHashPattern  = regexp.MustCompile(`#[^\n]*`)
	stringLiteralPattern    = regexp.MustCompile(`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`)
)

func stripCommentsAndStrings(code string, language string) string {
	code = tripleQuotePattern.ReplaceAllString(code, `""`)
	code = blockCommentPattern.ReplaceAllString(code, " ")
	if language == "python" {
		code = lineCommentHashPattern.ReplaceAllString(code, "")
	} else {
		code = lineCommentSlashPattern.ReplaceAllString(code, "")
	}
	code = stringLiteralPattern.ReplaceAllString(code, `""`)
	return code
}

// --------------------------------------------------------------------------
// loop nesting - brace languages (java/cpp/c/javascript/typescript/go)
// --------------------------------------------------------------------------

// halvingLoopPattern flags a loop step that shrinks/grows geometrically
// (binary search, doubling) rather than linearly - augmented-assignment
// forms (`/= 2`, `>>= 1`) plus the more common binary-search idiom of
// recomputing a midpoint (`(lo+hi)/2`, `(lo+hi)//2`, `(lo+hi)>>1`). The
// bare-division forms are looser and can over-match an unrelated `/2` (e.g.
// an average computed inside an otherwise-linear loop) - an acceptable
// false positive for a heuristic that's already documented as approximate.
var halvingLoopPattern = regexp.MustCompile(
	`(/=\s*2\b|>>=\s*1\b|\*=\s*2\b|<<=\s*1\b|//\s*2\b|/\s*2\b|>>\s*1\b)`)

// analyzeLoopNestingBraces walks the code tracking brace nesting, marking a
// '{' as a "loop frame" when it's immediately preceded (modulo whitespace and
// a single balanced parenthesized condition) by for/while/do. maxDepth is the
// deepest simultaneous loop nesting seen anywhere in the code.
func analyzeLoopNestingBraces(code string) (maxDepth int, hasHalving bool) {
	type frame struct{ isLoop bool }
	var stack []frame
	depth := 0

	for i := 0; i < len(code); i++ {
		switch code[i] {
		case '{':
			isLoop := precedingKeywordIsLoop(code, i)
			if isLoop {
				depth++
				if depth > maxDepth {
					maxDepth = depth
				}
			}
			stack = append(stack, frame{isLoop: isLoop})
		case '}':
			if n := len(stack); n > 0 {
				top := stack[n-1]
				stack = stack[:n-1]
				if top.isLoop {
					depth--
				}
			}
		}
	}
	return maxDepth, halvingLoopPattern.MatchString(code)
}

// precedingKeywordIsLoop checks whether the '{' at code[braceIdx] opens a
// for/while/do block, by looking at what's immediately before it: either a
// balanced (...) group preceded by for/while, or the bare keyword do.
func precedingKeywordIsLoop(code string, braceIdx int) bool {
	j := braceIdx
	for j > 0 && isSpace(code[j-1]) {
		j--
	}
	if j > 0 && code[j-1] == ')' {
		// Walk back to the matching '('.
		depth := 0
		k := j - 1
		for k >= 0 {
			if code[k] == ')' {
				depth++
			} else if code[k] == '(' {
				depth--
				if depth == 0 {
					break
				}
			}
			k--
		}
		if k <= 0 {
			return false
		}
		before := strings.TrimRight(code[:k], " \t\r\n")
		return hasKeywordSuffix(before, "for") || hasKeywordSuffix(before, "while")
	}
	before := strings.TrimRight(code[:j], " \t\r\n")
	return hasKeywordSuffix(before, "do")
}

func hasKeywordSuffix(s string, kw string) bool {
	if !strings.HasSuffix(s, kw) {
		return false
	}
	idx := len(s) - len(kw)
	if idx == 0 {
		return true
	}
	return !isIdentChar(s[idx-1])
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\r' || b == '\n'
}

func isIdentChar(b byte) bool {
	return b == '_' || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9')
}

// --------------------------------------------------------------------------
// loop nesting - Python (indentation-based, no braces)
// --------------------------------------------------------------------------

var pythonLoopLinePattern = regexp.MustCompile(`^(\s*)(for|while)\b`)

func analyzeLoopNestingPython(code string) (maxDepth int, hasHalving bool) {
	lines := strings.Split(code, "\n")
	var indents []int
	depth := 0

	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		indent := leadingSpaces(line)
		for len(indents) > 0 && indent <= indents[len(indents)-1] {
			indents = indents[:len(indents)-1]
			depth--
		}
		if pythonLoopLinePattern.MatchString(line) {
			indents = append(indents, indent)
			depth++
			if depth > maxDepth {
				maxDepth = depth
			}
		}
	}
	return maxDepth, halvingLoopPattern.MatchString(code)
}

func leadingSpaces(line string) int {
	n := 0
	for n < len(line) && (line[n] == ' ' || line[n] == '\t') {
		n++
	}
	return n
}

// --------------------------------------------------------------------------
// recursion detection
// --------------------------------------------------------------------------

// funcDefPattern matches a simple "name(params) {" function signature -
// deliberately loose (no return-type grammar per language) since it only
// needs to find candidate function bodies, not validate full syntax.
var funcDefPattern = regexp.MustCompile(`\b([A-Za-z_]\w*)\s*\([^()]*\)\s*\{`)

// controlKeywords are words that can precede "(...) {" without being a
// function definition - excluded so e.g. `if (x) {` doesn't get treated as
// a (self-)recursive function named "if".
var controlKeywords = map[string]bool{
	"if": true, "for": true, "while": true, "switch": true, "catch": true, "else": true,
}

func countSelfRecursiveCalls(code string, language string) int {
	if language == "python" {
		return countSelfRecursiveCallsPython(code)
	}

	maxSelfCalls := 0
	for _, m := range funcDefPattern.FindAllStringSubmatchIndex(code, -1) {
		name := code[m[2]:m[3]]
		if controlKeywords[name] {
			continue
		}
		bodyStart := m[1] // index right after the opening '{'
		bodyEnd := findMatchingBrace(code, m[1]-1)
		if bodyEnd < 0 || bodyEnd <= bodyStart {
			continue
		}
		count := countCallsTo(code[bodyStart:bodyEnd], name)
		if count > maxSelfCalls {
			maxSelfCalls = count
		}
	}
	return maxSelfCalls
}

var pythonDefPattern = regexp.MustCompile(`^(\s*)def\s+(\w+)\s*\(`)

func countSelfRecursiveCallsPython(code string) int {
	lines := strings.Split(code, "\n")
	maxSelfCalls := 0

	for i, line := range lines {
		m := pythonDefPattern.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		indent := len(m[1])
		name := m[2]
		count := 0
		for j := i + 1; j < len(lines); j++ {
			l := lines[j]
			if strings.TrimSpace(l) == "" {
				continue
			}
			if leadingSpaces(l) <= indent {
				break
			}
			count += countCallsTo(l, name)
		}
		if count > maxSelfCalls {
			maxSelfCalls = count
		}
	}
	return maxSelfCalls
}

// findMatchingBrace returns the index of the '}' matching the '{' at
// code[openIdx], or -1 if unbalanced.
func findMatchingBrace(code string, openIdx int) int {
	if openIdx < 0 || openIdx >= len(code) || code[openIdx] != '{' {
		return -1
	}
	depth := 0
	for i := openIdx; i < len(code); i++ {
		switch code[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

func countCallsTo(body string, name string) int {
	pattern := regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\s*\(`)
	return len(pattern.FindAllStringIndex(body, -1))
}

// --------------------------------------------------------------------------
// sort calls / sized allocations
// --------------------------------------------------------------------------

var sortCallPattern = regexp.MustCompile(
	`(?i)\bsorted\s*\(|\.sort\s*\(|Arrays\.sort|Collections\.sort|std::sort|sort\.Slice|sort\.Ints|sort\.Strings|sort\.Sort`)

var sizedAllocationPattern = regexp.MustCompile(
	`new\s+\w+\s*\[|new\s+(ArrayList|HashMap|HashSet|LinkedList|TreeMap|TreeSet|Vector|StringBuilder)\b` +
		`|\bmake\(\s*\[\]|\bmake\(\s*map\[` +
		`|std::vector\s*<|std::map\s*<|std::set\s*<|std::unordered_map\s*<|std::unordered_set\s*<` +
		`|\[0\]\s*\*|\*\s*len\(|\bdict\(\)|\blist\(\)|\bset\(\)` +
		`|new Array\(|new Map\(|new Set\(`)

// --------------------------------------------------------------------------
// classification
// --------------------------------------------------------------------------

func classifyTime(maxLoopNesting int, hasHalvingLoop bool, selfCallCount int, hasSort bool) string {
	switch {
	case selfCallCount >= 2:
		// Branching recursion (e.g. naive fibonacci, subset enumeration) -
		// no attempt to detect memoization/DP, so this is a worst-case guess.
		return "O(2^n)"
	case selfCallCount == 1:
		if maxLoopNesting >= 1 {
			return "O(n^2)" // a loop inside a linear recursive chain
		}
		return "O(n)"
	case maxLoopNesting == 0:
		if hasSort {
			return "O(n log n)"
		}
		return "O(1)"
	case maxLoopNesting == 1:
		if hasHalvingLoop {
			return "O(log n)"
		}
		if hasSort {
			return "O(n log n)"
		}
		return "O(n)"
	case maxLoopNesting == 2:
		return "O(n^2)"
	case maxLoopNesting == 3:
		return "O(n^3)"
	default:
		return "worse than O(n^3)"
	}
}

func classifySpace(selfCallCount int, hasSizedAllocation bool) string {
	if selfCallCount >= 1 {
		// Call stack depth proportional to input, regardless of whether the
		// recursion is linear or branching (branching still has O(n) depth).
		return "O(n)"
	}
	if hasSizedAllocation {
		return "O(n)"
	}
	return "O(1)"
}
