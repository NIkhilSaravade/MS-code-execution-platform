// This file has NO React/JSX in it at all — it's plain TypeScript data and
// types. Pages import from here so all the "mock backend" content lives in
// one place. Later, this file can be deleted once real data comes from
// problem-service over HTTP (see src/api/client.ts).

// A "union type": Difficulty can ONLY ever be one of these three exact
// strings. If you try to assign difficulty = 'Impossible' anywhere,
// TypeScript will refuse to compile. This is called a "string literal union".
export type Difficulty = 'Easy' | 'Medium' | 'Hard';

// An `interface` describes the SHAPE an object must have — which keys, and
// what type each key's value must be. It's a compile-time-only concept:
// none of this exists in the JavaScript that actually runs in the browser,
// it's purely there to catch mistakes while you're writing code.
export interface Example {
  input: string;
  output: string;
  explanation?: string; // `?` = optional; some examples have no explanation
}

// Another string literal union, this time for programming languages.
export type Language = 'javascript' | 'typescript' | 'python' | 'java' | 'cpp' | 'c' | 'go';

// The main shape for one coding problem. Every object in the `problems`
// array below must match this shape exactly, or TypeScript will error.
export interface Problem {
  id: number;
  slug: string;        // URL-safe id, e.g. "two-sum" -> /practice/two-sum
  // The numeric problemId this maps to in the REAL problem-service database
  // (see problem-service's POST /problems and its seeded test cases).
  // Optional because most of the problems below are still browsing-only mock
  // content with no matching real test cases - only entries with a
  // backendProblemId can actually be Run/Submitted for real judging.
  backendProblemId?: number;
  title: string;
  difficulty: Difficulty;    // reuses the union type above
  tags: string[];             // `string[]` = an array of strings
  companies: string[];
  acceptance: number;
  description: string;
  examples: Example[];        // an array of objects shaped like `Example`
  constraints: string[];
  // Record<K, V> is a built-in TypeScript utility type meaning "an object
  // whose keys are all of type K and whose values are all of type V".
  // So starterCode is required to have EXACTLY one entry per Language:
  // { javascript: '...', python: '...', java: '...', cpp: '...' }
  starterCode: Record<Language, string>;
}

// A plain array of objects describing the dropdown options for language
// selection. The type annotation `: { id: Language; label: string }[]`
// is an "inline" object type — same idea as an interface, just not given
// its own name since it's only used here.
// Labels include the version that actually judges a submission - i.e. the
// Go worker's version (worker-service-go is the default ACTIVE_WORKER; the
// legacy Java worker runs older versions for some languages - see
// CLAUDE.md's "Multi-language judging" section). C/C++ show the compiled
// LANGUAGE STANDARD (-std=c++17/-std=c11, pinned explicitly in both
// workers' compile commands), not the compiler version, since that's what
// programmers actually care about and matches how LeetCode itself labels
// these two.
export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'javascript', label: 'JavaScript (Node 20)' },
  { id: 'typescript', label: 'TypeScript 7.0' },
  { id: 'python', label: 'Python 3.12' },
  { id: 'java', label: 'Java 21' },
  { id: 'cpp', label: 'C++17' },
  { id: 'c', label: 'C11' },
  { id: 'go', label: 'Go 1.22' },
];

// `problems: Problem[]` means: an array where every element must satisfy
// the Problem interface above. TypeScript checks every object below
// against it — try deleting a required field like `title` from one of
// these and the compiler will point at exactly that spot.
export const problems: Problem[] = [
  {
    id: 1,
    slug: 'two-sum',
    backendProblemId: 14,
    title: 'Two Sum',
    difficulty: 'Easy',
    tags: ['Array', 'Hash Table'],
    companies: ['Google', 'Amazon', 'Meta'],
    acceptance: 54.2,
    description:
      'Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.\n\nYou may assume that each input has exactly one solution, and you may not use the same element twice.',
    examples: [
      { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: 'nums[0] + nums[1] == 9' },
      { input: 'nums = [3,2,4], target = 6', output: '[1,2]' },
    ],
    constraints: ['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9', 'Only one valid answer exists.'],
    starterCode: {
      javascript:
        '/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nfunction twoSum(nums, target) {\n  \n}\n',
      typescript: 'function twoSum(nums: number[], target: number): number[] {\n  \n};\n',
      python: 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        pass\n',
      java:
        'class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        \n    }\n}\n',
      cpp:
        'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        \n    }\n};\n',
      c:
        '/**\n * Note: The returned array must be malloced, assume caller calls free().\n */\nint* twoSum(int* nums, int numsSize, int target, int* returnSize) {\n    \n}\n',
      go: 'func twoSum(nums []int, target int) []int {\n\t\n}\n',
    },
  },
  {
    id: 2,
    slug: 'valid-parentheses',
    title: 'Valid Parentheses',
    difficulty: 'Easy',
    tags: ['String', 'Stack'],
    companies: ['Amazon', 'Microsoft'],
    acceptance: 41.3,
    description:
      "Given a string `s` containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.\n\nAn input string is valid if brackets are closed by the same type and in the correct order.",
    examples: [
      { input: 's = "()[]{}"', output: 'true' },
      { input: 's = "(]"', output: 'false' },
    ],
    constraints: ['1 <= s.length <= 10^4', "s consists only of parentheses '()[]{}'"],
    starterCode: {
      javascript: '/**\n * @param {string} s\n * @return {boolean}\n */\nfunction isValid(s) {\n  \n}\n',
      typescript: 'function isValid(s: string): boolean {\n  \n};\n',
      python: 'class Solution:\n    def isValid(self, s: str) -> bool:\n        pass\n',
      java: 'class Solution {\n    public boolean isValid(String s) {\n        \n    }\n}\n',
      cpp: 'class Solution {\npublic:\n    bool isValid(string s) {\n        \n    }\n};\n',
      c: 'bool isValid(char* s) {\n    \n}\n',
      go: 'func isValid(s string) bool {\n\t\n}\n',
    },
  },
  {
    id: 3,
    slug: 'merge-intervals',
    title: 'Merge Intervals',
    difficulty: 'Medium',
    tags: ['Array', 'Sorting'],
    companies: ['Google', 'Facebook'],
    acceptance: 46.8,
    description:
      "Given an array of `intervals` where `intervals[i] = [start_i, end_i]`, merge all overlapping intervals and return an array of the non-overlapping intervals that cover all the intervals in the input.",
    examples: [
      { input: 'intervals = [[1,3],[2,6],[8,10],[15,18]]', output: '[[1,6],[8,10],[15,18]]' },
      { input: 'intervals = [[1,4],[4,5]]', output: '[[1,5]]' },
    ],
    constraints: ['1 <= intervals.length <= 10^4', 'intervals[i].length == 2'],
    starterCode: {
      javascript:
        '/**\n * @param {number[][]} intervals\n * @return {number[][]}\n */\nfunction merge(intervals) {\n  \n}\n',
      typescript: 'function merge(intervals: number[][]): number[][] {\n  \n};\n',
      python: 'class Solution:\n    def merge(self, intervals: list[list[int]]) -> list[list[int]]:\n        pass\n',
      java:
        'class Solution {\n    public int[][] merge(int[][] intervals) {\n        \n    }\n}\n',
      cpp:
        'class Solution {\npublic:\n    vector<vector<int>> merge(vector<vector<int>>& intervals) {\n        \n    }\n};\n',
      c:
        '/**\n * Return an array of arrays. The sizes of the arrays are returned as *returnColumnSizes array.\n * Note: Both returned array and *columnSizes array must be malloced.\n */\nint** merge(int** intervals, int intervalsSize, int* intervalsColSize, int* returnSize, int** returnColumnSizes) {\n    \n}\n',
      go: 'func merge(intervals [][]int) [][]int {\n\t\n}\n',
    },
  },
  {
    id: 4,
    slug: 'longest-substring-without-repeating-characters',
    title: 'Longest Substring Without Repeating Characters',
    difficulty: 'Medium',
    tags: ['String', 'Sliding Window'],
    companies: ['Amazon', 'Bloomberg'],
    acceptance: 33.9,
    description: 'Given a string `s`, find the length of the longest substring without repeating characters.',
    examples: [
      { input: 's = "abcabcbb"', output: '3', explanation: 'The answer is "abc".' },
      { input: 's = "bbbbb"', output: '1' },
    ],
    constraints: ['0 <= s.length <= 5 * 10^4'],
    starterCode: {
      javascript:
        '/**\n * @param {string} s\n * @return {number}\n */\nfunction lengthOfLongestSubstring(s) {\n  \n}\n',
      typescript: 'function lengthOfLongestSubstring(s: string): number {\n  \n};\n',
      python: 'class Solution:\n    def lengthOfLongestSubstring(self, s: str) -> int:\n        pass\n',
      java: 'class Solution {\n    public int lengthOfLongestSubstring(String s) {\n        \n    }\n}\n',
      cpp: 'class Solution {\npublic:\n    int lengthOfLongestSubstring(string s) {\n        \n    }\n};\n',
      c: 'int lengthOfLongestSubstring(char* s) {\n    \n}\n',
      go: 'func lengthOfLongestSubstring(s string) int {\n\t\n}\n',
    },
  },
  {
    id: 5,
    slug: 'median-of-two-sorted-arrays',
    title: 'Median of Two Sorted Arrays',
    difficulty: 'Hard',
    tags: ['Array', 'Binary Search'],
    companies: ['Google', 'Apple'],
    acceptance: 37.1,
    description:
      'Given two sorted arrays `nums1` and `nums2` of size `m` and `n` respectively, return the median of the two sorted arrays.\n\nThe overall run time complexity should be `O(log (m+n))`.',
    examples: [
      { input: 'nums1 = [1,3], nums2 = [2]', output: '2.00000' },
      { input: 'nums1 = [1,2], nums2 = [3,4]', output: '2.50000' },
    ],
    constraints: ['nums1.length == m', 'nums2.length == n', '0 <= m,n <= 1000'],
    starterCode: {
      javascript:
        '/**\n * @param {number[]} nums1\n * @param {number[]} nums2\n * @return {number}\n */\nfunction findMedianSortedArrays(nums1, nums2) {\n  \n}\n',
      typescript:
        'function findMedianSortedArrays(nums1: number[], nums2: number[]): number {\n  \n};\n',
      python:
        'class Solution:\n    def findMedianSortedArrays(self, nums1: list[int], nums2: list[int]) -> float:\n        pass\n',
      java:
        'class Solution {\n    public double findMedianSortedArrays(int[] nums1, int[] nums2) {\n        \n    }\n}\n',
      cpp:
        'class Solution {\npublic:\n    double findMedianSortedArrays(vector<int>& nums1, vector<int>& nums2) {\n        \n    }\n};\n',
      c:
        'double findMedianSortedArrays(int* nums1, int nums1Size, int* nums2, int nums2Size) {\n    \n}\n',
      go: 'func findMedianSortedArrays(nums1 []int, nums2 []int) float64 {\n\t\n}\n',
    },
  },
  {
    id: 6,
    slug: 'binary-tree-level-order-traversal',
    title: 'Binary Tree Level Order Traversal',
    difficulty: 'Medium',
    tags: ['Tree', 'BFS'],
    companies: ['Microsoft', 'Amazon'],
    acceptance: 64.5,
    description:
      "Given the `root` of a binary tree, return the level order traversal of its nodes' values (i.e., from left to right, level by level).",
    examples: [
      { input: 'root = [3,9,20,null,null,15,7]', output: '[[3],[9,20],[15,7]]' },
      { input: 'root = [1]', output: '[[1]]' },
    ],
    constraints: ['The number of nodes is in the range [0, 2000].'],
    starterCode: {
      javascript:
        '/**\n * @param {TreeNode} root\n * @return {number[][]}\n */\nfunction levelOrder(root) {\n  \n}\n',
      typescript: 'function levelOrder(root: TreeNode | null): number[][] {\n  \n};\n',
      python: 'class Solution:\n    def levelOrder(self, root: Optional[TreeNode]) -> list[list[int]]:\n        pass\n',
      java:
        'class Solution {\n    public List<List<Integer>> levelOrder(TreeNode root) {\n        \n    }\n}\n',
      cpp:
        'class Solution {\npublic:\n    vector<vector<int>> levelOrder(TreeNode* root) {\n        \n    }\n};\n',
      c:
        'int** levelOrder(struct TreeNode* root, int* returnSize, int** returnColumnSizes) {\n    \n}\n',
      go: 'func levelOrder(root *TreeNode) [][]int {\n\t\n}\n',
    },
  },
  {
    id: 7,
    slug: 'course-schedule',
    title: 'Course Schedule',
    difficulty: 'Medium',
    tags: ['Graph', 'Topological Sort'],
    companies: ['Facebook', 'Google'],
    acceptance: 46.9,
    description:
      "There are `numCourses` courses labeled 0 to numCourses-1. Given `prerequisites` where `prerequisites[i] = [a, b]` indicates you must take course `b` before course `a`, return true if you can finish all courses.",
    examples: [
      { input: 'numCourses = 2, prerequisites = [[1,0]]', output: 'true' },
      { input: 'numCourses = 2, prerequisites = [[1,0],[0,1]]', output: 'false' },
    ],
    constraints: ['1 <= numCourses <= 2000'],
    starterCode: {
      javascript:
        '/**\n * @param {number} numCourses\n * @param {number[][]} prerequisites\n * @return {boolean}\n */\nfunction canFinish(numCourses, prerequisites) {\n  \n}\n',
      typescript:
        'function canFinish(numCourses: number, prerequisites: number[][]): boolean {\n  \n};\n',
      python:
        'class Solution:\n    def canFinish(self, numCourses: int, prerequisites: list[list[int]]) -> bool:\n        pass\n',
      java:
        'class Solution {\n    public boolean canFinish(int numCourses, int[][] prerequisites) {\n        \n    }\n}\n',
      cpp:
        'class Solution {\npublic:\n    bool canFinish(int numCourses, vector<vector<int>>& prerequisites) {\n        \n    }\n};\n',
      c:
        'bool canFinish(int numCourses, int** prerequisites, int prerequisitesSize, int* prerequisitesColSize) {\n    \n}\n',
      go: 'func canFinish(numCourses int, prerequisites [][]int) bool {\n\t\n}\n',
    },
  },
  {
    id: 8,
    slug: 'climbing-stairs',
    title: 'Climbing Stairs',
    difficulty: 'Easy',
    tags: ['Dynamic Programming'],
    companies: ['Adobe', 'Apple'],
    acceptance: 52.4,
    description:
      'You are climbing a staircase with `n` steps. Each time you can climb 1 or 2 steps. In how many distinct ways can you climb to the top?',
    examples: [
      { input: 'n = 2', output: '2' },
      { input: 'n = 3', output: '3' },
    ],
    constraints: ['1 <= n <= 45'],
    starterCode: {
      javascript: '/**\n * @param {number} n\n * @return {number}\n */\nfunction climbStairs(n) {\n  \n}\n',
      typescript: 'function climbStairs(n: number): number {\n  \n};\n',
      python: 'class Solution:\n    def climbStairs(self, n: int) -> int:\n        pass\n',
      java: 'class Solution {\n    public int climbStairs(int n) {\n        \n    }\n}\n',
      cpp: 'class Solution {\npublic:\n    int climbStairs(int n) {\n        \n    }\n};\n',
      c: 'int climbStairs(int n) {\n    \n}\n',
      go: 'func climbStairs(n int) int {\n\t\n}\n',
    },
  },
  {
    id: 9,
    slug: 'word-search',
    title: 'Word Search',
    difficulty: 'Medium',
    tags: ['Backtracking', 'Matrix'],
    companies: ['Microsoft', 'Uber'],
    acceptance: 40.2,
    description:
      "Given an `m x n` grid of characters `board` and a string `word`, return true if `word` exists in the grid, constructed from adjacent cells (horizontally or vertically neighboring), not reusing the same cell twice.",
    examples: [
      { input: 'board = [["A","B","C"],["S","F","C"],["A","D","E"]], word = "ABCCED"', output: 'true' },
      { input: 'board = [["A","B"],["C","D"]], word = "ABCD"', output: 'false' },
    ],
    constraints: ['1 <= word.length <= 15'],
    starterCode: {
      javascript:
        '/**\n * @param {character[][]} board\n * @param {string} word\n * @return {boolean}\n */\nfunction exist(board, word) {\n  \n}\n',
      typescript: 'function exist(board: string[][], word: string): boolean {\n  \n};\n',
      python: 'class Solution:\n    def exist(self, board: list[list[str]], word: str) -> bool:\n        pass\n',
      java:
        'class Solution {\n    public boolean exist(char[][] board, String word) {\n        \n    }\n}\n',
      cpp:
        'class Solution {\npublic:\n    bool exist(vector<vector<char>>& board, string word) {\n        \n    }\n};\n',
      c:
        'bool exist(char** board, int boardSize, int* boardColSize, char* word) {\n    \n}\n',
      go: 'func exist(board [][]byte, word string) bool {\n\t\n}\n',
    },
  },
  {
    id: 10,
    slug: 'lru-cache',
    title: 'LRU Cache',
    difficulty: 'Hard',
    tags: ['Design', 'Hash Table', 'Linked List'],
    companies: ['Amazon', 'Google', 'Uber'],
    acceptance: 42.6,
    description:
      'Design a data structure that follows the constraints of a Least Recently Used (LRU) cache with `get` and `put` operations running in O(1) average time complexity.',
    examples: [
      {
        input: 'LRUCache(2); put(1,1); put(2,2); get(1); put(3,3); get(2)',
        output: '[null,null,null,1,null,-1]',
      },
    ],
    constraints: ['1 <= capacity <= 3000'],
    starterCode: {
      javascript:
        '/**\n * @param {number} capacity\n */\nfunction LRUCache(capacity) {\n  \n}\n\nLRUCache.prototype.get = function(key) {\n  \n};\n\nLRUCache.prototype.put = function(key, value) {\n  \n};\n',
      typescript:
        'class LRUCache {\n    constructor(capacity: number) {\n        \n    }\n\n    get(key: number): number {\n        \n    }\n\n    put(key: number, value: number): void {\n        \n    }\n}\n',
      python:
        'class LRUCache:\n    def __init__(self, capacity: int):\n        pass\n\n    def get(self, key: int) -> int:\n        pass\n\n    def put(self, key: int, value: int) -> None:\n        pass\n',
      java:
        'class LRUCache {\n    public LRUCache(int capacity) {\n        \n    }\n\n    public int get(int key) {\n        \n    }\n\n    public void put(int key, int value) {\n        \n    }\n}\n',
      cpp:
        'class LRUCache {\npublic:\n    LRUCache(int capacity) {\n        \n    }\n\n    int get(int key) {\n        \n    }\n\n    void put(int key, int value) {\n        \n    }\n};\n',
      c:
        'typedef struct {\n    \n} LRUCache;\n\nLRUCache* lRUCacheCreate(int capacity) {\n    \n}\n\nint lRUCacheGet(LRUCache* obj, int key) {\n    \n}\n\nvoid lRUCachePut(LRUCache* obj, int key, int value) {\n    \n}\n\nvoid lRUCacheFree(LRUCache* obj) {\n    \n}\n',
      go:
        'type LRUCache struct {\n\t\n}\n\nfunc Constructor(capacity int) LRUCache {\n\t\n}\n\nfunc (c *LRUCache) Get(key int) int {\n\t\n}\n\nfunc (c *LRUCache) Put(key int, value int) {\n\t\n}\n',
    },
  },
  {
    id: 11,
    slug: 'maximum-subarray',
    backendProblemId: 15,
    title: 'Maximum Subarray',
    difficulty: 'Medium',
    tags: ['Array', 'Dynamic Programming'],
    companies: ['Amazon', 'LinkedIn'],
    acceptance: 50.7,
    description:
      'Given an integer array `nums`, find the subarray with the largest sum, and return its sum.',
    examples: [
      { input: 'nums = [-2,1,-3,4,-1,2,1,-5,4]', output: '6', explanation: '[4,-1,2,1] has the largest sum 6.' },
      { input: 'nums = [1]', output: '1' },
    ],
    constraints: ['1 <= nums.length <= 10^5'],
    starterCode: {
      javascript: '/**\n * @param {number[]} nums\n * @return {number}\n */\nfunction maxSubArray(nums) {\n  \n}\n',
      typescript: 'function maxSubArray(nums: number[]): number {\n  \n};\n',
      python: 'class Solution:\n    def maxSubArray(self, nums: list[int]) -> int:\n        pass\n',
      java: 'class Solution {\n    public int maxSubArray(int[] nums) {\n        \n    }\n}\n',
      cpp: 'class Solution {\npublic:\n    int maxSubArray(vector<int>& nums) {\n        \n    }\n};\n',
      c: 'int maxSubArray(int* nums, int numsSize) {\n    \n}\n',
      go: 'func maxSubArray(nums []int) int {\n\t\n}\n',
    },
  },
  {
    id: 12,
    slug: 'number-of-islands',
    title: 'Number of Islands',
    difficulty: 'Medium',
    tags: ['Matrix', 'DFS', 'BFS'],
    companies: ['Amazon', 'Meta', 'Bloomberg'],
    acceptance: 58.3,
    description:
      "Given an `m x n` 2D binary grid `grid` which represents a map of '1's (land) and '0's (water), return the number of islands.",
    examples: [
      {
        input: 'grid = [["1","1","0"],["1","1","0"],["0","0","1"]]',
        output: '2',
      },
    ],
    constraints: ['1 <= m, n <= 300'],
    starterCode: {
      javascript:
        '/**\n * @param {character[][]} grid\n * @return {number}\n */\nfunction numIslands(grid) {\n  \n}\n',
      typescript: 'function numIslands(grid: string[][]): number {\n  \n};\n',
      python: 'class Solution:\n    def numIslands(self, grid: list[list[str]]) -> int:\n        pass\n',
      java: 'class Solution {\n    public int numIslands(char[][] grid) {\n        \n    }\n}\n',
      cpp:
        'class Solution {\npublic:\n    int numIslands(vector<vector<char>>& grid) {\n        \n    }\n};\n',
      c:
        'int numIslands(char** grid, int gridSize, int* gridColSize) {\n    \n}\n',
      go: 'func numIslands(grid [][]byte) int {\n\t\n}\n',
    },
  },
];

// A plain lookup function — not React-specific. `.find()` is a built-in
// array method that returns the FIRST element matching the condition, or
// `undefined` if none match. The return type `Problem | undefined` makes
// that explicit, forcing callers (see SolvePage.tsx) to handle the "not
// found" case instead of assuming a problem always exists.
export function getProblemBySlug(slug: string): Problem | undefined {
  return problems.find((p) => p.slug === slug);
  // `(p) => p.slug === slug` is an "arrow function" — a shorthand way to
  // write a small function. Equivalent to: function(p) { return p.slug === slug; }
}

// A small color-lookup table keyed by Difficulty. Because of
// `Record<Difficulty, string>`, TypeScript FORCES this object to have
// exactly the keys Easy/Medium/Hard (no more, no less) — add a new
// Difficulty value above and this object won't compile until you add its
// color too. Used by PracticePage and SolvePage to color-code badges.
export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  Easy: '#34d399',
  Medium: '#fbbf24',
  Hard: '#f87171',
};