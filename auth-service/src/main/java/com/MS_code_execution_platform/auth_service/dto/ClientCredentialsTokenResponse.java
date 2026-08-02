package com.MS_code_execution_platform.auth_service.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class ClientCredentialsTokenResponse {

    @JsonProperty("access_token")
    private String accessToken;

    @JsonProperty("token_type")
    private String tokenType;

    @JsonProperty("expires_in")
    private long expiresIn;
}
