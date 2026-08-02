package com.MS_code_execution_platform.user_service.security;

import com.MS_code_execution_platform.user_service.entity.User;
import com.MS_code_execution_platform.user_service.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Bootstraps exactly one ADMIN account on first startup, so there's a way to
 * reach ADMIN-gated endpoints (e.g. problem-service's POST /problems) without
 * hand-editing the database. Idempotent - safe to run on every startup, since
 * it only acts when no ADMIN exists yet. Once that first admin exists, use
 * PATCH /users/{email}/role to promote anyone else.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AdminBootstrap {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @Value("${admin.seed.email}")
    private String seedEmail;

    @Value("${admin.seed.password}")
    private String seedPassword;

    @EventListener(ApplicationReadyEvent.class)
    public void seedAdminIfMissing() {

        if (userRepository.existsByRole("ADMIN")) {
            return;
        }

        User admin = userRepository.findByEmail(seedEmail)
                .map(existing -> {
                    existing.setRole("ADMIN");
                    return existing;
                })
                .orElseGet(() -> User.builder()
                        .email(seedEmail)
                        .password(passwordEncoder.encode(seedPassword))
                        .role("ADMIN")
                        .build());

        userRepository.save(admin);
        log.warn("Seeded ADMIN account ({}) - change its password and rotate ADMIN_SEED_PASSWORD in production", seedEmail);
    }
}
