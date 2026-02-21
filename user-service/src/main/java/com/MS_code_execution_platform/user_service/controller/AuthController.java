package com.MS_code_execution_platform.user_service.controller;


import com.MS_code_execution_platform.user_service.dto.AuthResponse;
import com.MS_code_execution_platform.user_service.dto.LoginRequest;
import com.MS_code_execution_platform.user_service.dto.RegisterRequest;
import com.MS_code_execution_platform.user_service.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

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

}

