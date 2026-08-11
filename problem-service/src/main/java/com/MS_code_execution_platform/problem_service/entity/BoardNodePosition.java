package com.MS_code_execution_platform.problem_service.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

// Where a user has manually dragged one board node (a problem or a
// BoardCard) to on the Practice page's 2D "Board" view - personal, same
// ownership model as BoardConnection/BoardCard. Unlike GraphNodePosition
// (3D, x/y/z) this is a flat 2D canvas, so only x/y are tracked. A node
// with no row here starts at a default spawn position on the client.
@Entity
@Table(name = "board_node_position")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BoardNodePosition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "node_type")
    private BoardNodeType nodeType;

    @Column(name = "node_id")
    private Long nodeId;

    private double x;
    private double y;

    private Instant updatedAt;
}
