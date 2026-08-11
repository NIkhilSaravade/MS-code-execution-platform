package com.MS_code_execution_platform.problem_service.repository;

import com.MS_code_execution_platform.problem_service.entity.BoardCard;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

// One shared board - findAll()/findById()/existsById() (all inherited from
// JpaRepository) are all this needs now; the per-user query methods this
// used to have were removed along with the per-user board design.
@Repository
public interface BoardCardRepository extends JpaRepository<BoardCard, Long> {
}
