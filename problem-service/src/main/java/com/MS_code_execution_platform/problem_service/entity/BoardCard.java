package com.MS_code_execution_platform.problem_service.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

// A free-standing, personal (per-user) pattern/category node on the
// Practice page's 2D "Board" view (e.g. "Two Pointers", "Sliding Window") -
// has no backing Problem, just a title and an optional color for the
// branch/connector lines drawn to it. Independent of GraphCard (the 3D
// graph view's equivalent) so the two views never share nodes.
@Entity
@Table(name = "board_card")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BoardCard {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private UUID userId;

    private String title;

    private String color;

    // Manual override for the card's box size / title font size, as a
    // 1-10 level rather than raw pixels (see the corner drag-handle resize
    // and the font +/- control on ProblemBoard2D's card boxes) - null means
    // "use the frontend's own default level".
    private Integer sizeLevel;
    private Integer fontLevel;

    private Instant createdAt;
}
