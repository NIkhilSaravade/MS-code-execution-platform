package com.MS_code_execution_platform.auth_service.controller;

import com.MS_code_execution_platform.auth_service.dto.AuthResponse;
import com.MS_code_execution_platform.auth_service.dto.LoginRequest;
import com.MS_code_execution_platform.auth_service.dto.RefreshRequest;
import com.MS_code_execution_platform.auth_service.dto.RegisterRequest;
import com.MS_code_execution_platform.auth_service.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/register")
    public AuthResponse register(@RequestBody RegisterRequest request) {
        return authService.register(request);
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @PostMapping("/refresh")
    public AuthResponse refresh(@RequestBody RefreshRequest request) {
        return authService.refresh(request.getRefreshToken());
    }
}
