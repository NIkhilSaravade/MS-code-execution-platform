package com.MS_code_execution_platform.user_service.service;

import com.MS_code_execution_platform.user_service.entity.User;
import com.MS_code_execution_platform.user_service.exception.ResourceNotFoundException;
import com.MS_code_execution_platform.user_service.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Set;

@Service
@RequiredArgsConstructor
public class UserService {

    private static final Set<String> ALLOWED_ROLES = Set.of("USER", "ADMIN");

    private final UserRepository userRepository;

    public String getUserIdByEmail(String email) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found"));

        return String.valueOf(user.getId());
    }

    // ADMIN-only (see SecurityConfig) - the only in-app way to grow the admin
    // set once the seeded bootstrap admin exists (see AdminBootstrap).
    public void updateRole(String email, String role) {

        if (!ALLOWED_ROLES.contains(role)) {
            throw new IllegalArgumentException("Unsupported role: " + role);
        }

        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new ResourceNotFoundException("User not found: " + email));

        user.setRole(role);
        userRepository.save(user);
    }
}
