package com.MS_code_execution_platform.auth_service.service;

import com.MS_code_execution_platform.auth_service.dto.AuthResponse;
import com.MS_code_execution_platform.auth_service.dto.LoginRequest;
import com.MS_code_execution_platform.auth_service.dto.RegisterRequest;
import com.MS_code_execution_platform.auth_service.exception.InvalidCredentialsException;
import com.MS_code_execution_platform.auth_service.exception.UserAlreadyExistsException;
import com.MS_code_execution_platform.grpc.userauth.GetUserRequest;
import com.MS_code_execution_platform.grpc.userauth.GetUserResponse;
import com.MS_code_execution_platform.grpc.userauth.RegisterUserRequest;
import com.MS_code_execution_platform.grpc.userauth.RegisterUserResponse;
import com.MS_code_execution_platform.grpc.userauth.UserAuthServiceGrpc;
import com.MS_code_execution_platform.grpc.userauth.ValidateCredentialsRequest;
import com.MS_code_execution_platform.grpc.userauth.ValidateCredentialsResponse;
import lombok.RequiredArgsConstructor;
import net.devh.boot.grpc.client.inject.GrpcClient;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final TokenService tokenService;

    @GrpcClient("user-service")
    private UserAuthServiceGrpc.UserAuthServiceBlockingStub userServiceStub;

    public AuthResponse register(RegisterRequest request) {

        RegisterUserResponse response = userServiceStub.registerUser(
                RegisterUserRequest.newBuilder()
                        .setEmail(request.getEmail())
                        .setPassword(request.getPassword())
                        .build());

        if (!response.getSuccess()) {
            throw new UserAlreadyExistsException(request.getEmail());
        }

        return issueTokenPair(response.getUserId(), response.getEmail(), response.getRole());
    }

    public AuthResponse login(LoginRequest request) {

        ValidateCredentialsResponse response = userServiceStub.validateCredentials(
                ValidateCredentialsRequest.newBuilder()
                        .setEmail(request.getEmail())
                        .setPassword(request.getPassword())
                        .build());

        if (!response.getValid()) {
            throw new InvalidCredentialsException("Invalid credentials");
        }

        return issueTokenPair(response.getUserId(), response.getEmail(), response.getRole());
    }

    public AuthResponse refresh(String rawRefreshToken) {

        String userId = tokenService.consumeRefreshToken(rawRefreshToken);

        GetUserResponse user = userServiceStub.getUser(
                GetUserRequest.newBuilder().setUserId(userId).build());

        if (!user.getFound()) {
            throw new InvalidCredentialsException("User no longer exists");
        }

        return issueTokenPair(user.getUserId(), user.getEmail(), user.getRole());
    }

    private AuthResponse issueTokenPair(String userId, String email, String role) {
        String accessToken = tokenService.issueAccessToken(userId, email, role);
        String refreshToken = tokenService.issueRefreshToken(userId);
        return new AuthResponse(accessToken, refreshToken);
    }
}
