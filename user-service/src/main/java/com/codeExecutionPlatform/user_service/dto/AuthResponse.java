package com.codeExecutionPlatform.user_service.dto;

import lombok.Data;

@Data
public class AuthResponse {

    private String token;

    public AuthResponse(String token) {
    }
}
