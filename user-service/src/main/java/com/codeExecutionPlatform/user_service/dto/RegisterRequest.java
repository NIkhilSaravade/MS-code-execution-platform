package com.codeExecutionPlatform.user_service.dto;

import lombok.Data;

@Data
public class RegisterRequest {

    private String email;

    private String password;
}
