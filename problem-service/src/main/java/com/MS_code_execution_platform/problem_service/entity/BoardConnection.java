package com.MS_code_execution_platform.problem_service.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

// A personal (per-user) edge between two board nodes on the Practice page's
// 2D "Board" view - either endpoint can be a Problem or a BoardCard (see
// BoardNodeType). Mirrors GraphConnection; see BoardService for the
// canonicalization (ordered by (type, id)) that keeps a pair from being
// stored twice in opposite directions.
@Entity
@Table(name = "board_connection")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BoardConnection {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "node_a_type")
    private BoardNodeType nodeAType;

    @Column(name = "node_a_id")
    private Long nodeAId;

    @Enumerated(EnumType.STRING)
    @Column(name = "node_b_type")
    private BoardNodeType nodeBType;

    @Column(name = "node_b_id")
    private Long nodeBId;

    private String color;

    private Instant createdAt;
}
