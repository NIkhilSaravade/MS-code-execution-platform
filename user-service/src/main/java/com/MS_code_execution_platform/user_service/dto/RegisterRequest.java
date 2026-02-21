package com.MS_code_execution_platform.user_service.dto;

import lombok.Data;

@Data
public class RegisterRequest {

    private String email;

    private String password;
}
