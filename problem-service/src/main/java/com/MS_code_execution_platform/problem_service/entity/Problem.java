package com.MS_code_execution_platform.problem_service.entity;


import com.fasterxml.jackson.annotation.JsonManagedReference;
import jakarta.persistence.*;
import lombok.*;

import java.util.List;

@Entity
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Problem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(columnDefinition = "TEXT")
    private String constraints;

    private Integer timeLimitMs;
    private Integer memoryLimitMb;

    // Optional function signature (see harness package) and the boilerplate
    // generated from it, once, at problem-creation time. Null when the
    // problem has no signature - it keeps working as a raw stdin/stdout
    // script judge, exactly as before this existed. paramsJson is the
    // FunctionSignature's params list, Jackson-serialized - stored as plain
    // text rather than a join table since it's write-once, read-whole.
    private String functionName;

    @Column(columnDefinition = "TEXT")
    private String paramsJson;

    private String returnType;

    @Column(columnDefinition = "TEXT")
    private String harnessPython;

    @Column(columnDefinition = "TEXT")
    private String harnessJava;

    // @JsonManagedReference/@JsonBackReference (paired with TestCase.problem)
    // break the Problem<->TestCase serialization cycle - without them, Jackson
    // walks Problem -> testCases -> TestCase.problem -> testCases -> ...
    // forever, producing a response that never terminates cleanly.
    @OneToMany(mappedBy = "problem", cascade = CascadeType.ALL, orphanRemoval = true)
    @JsonManagedReference
    private List<TestCase> testCases;

}
