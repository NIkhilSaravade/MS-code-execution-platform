package com.MS_code_execution_platform.auth_service.dto;

import lombok.Data;

@Data
public class LoginRequest {

    private String email;

    private String password;
}
