package com.MS_code_execution_platform.problem_service.entity;

// What kind of board node one end of a BoardConnection points at - a real
// Problem row, or a free-standing BoardCard (a personal pattern/category
// node with no backing problem, e.g. "Two Pointers"). Mirrors GraphNodeType
// for the Practice page's 2D "Board" (whimsical-style) view, kept as its
// own enum/table set so the Board and 3D Graph views never share nodes.
public enum BoardNodeType {
    PROBLEM,
    CARD
}
