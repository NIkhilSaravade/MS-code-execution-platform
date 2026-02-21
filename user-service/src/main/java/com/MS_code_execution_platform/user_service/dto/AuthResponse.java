package com.MS_code_execution_platform.user_service.dto;

import lombok.Data;

@Data
public class AuthResponse {

    private String token;
    public AuthResponse(String token) {
        this.token = token;   // ✅ THIS WAS MISSING
    }
}
