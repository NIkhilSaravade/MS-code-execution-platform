package com.codeExecutionPlatform.user_service.controller;


import com.codeExecutionPlatform.user_service.dto.AuthResponse;
import com.codeExecutionPlatform.user_service.dto.LoginRequest;
import com.codeExecutionPlatform.user_service.dto.RegisterRequest;
import com.codeExecutionPlatform.user_service.service.AuthService;
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
