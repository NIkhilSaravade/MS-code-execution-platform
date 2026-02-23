package com.MS_code_execution_platform.user_service.service;

import com.MS_code_execution_platform.user_service.entity.User;
import com.MS_code_execution_platform.user_service.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;

    public String getUserIdByEmail(String email) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found"));

        return String.valueOf(user.getId());
    }
}
