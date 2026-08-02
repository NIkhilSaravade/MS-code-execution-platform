package com.MS_code_execution_platform.user_service.grpc;

import com.MS_code_execution_platform.grpc.userauth.GetUserRequest;
import com.MS_code_execution_platform.grpc.userauth.GetUserResponse;
import com.MS_code_execution_platform.grpc.userauth.RegisterUserRequest;
import com.MS_code_execution_platform.grpc.userauth.RegisterUserResponse;
import com.MS_code_execution_platform.grpc.userauth.UserAuthServiceGrpc;
import com.MS_code_execution_platform.grpc.userauth.ValidateCredentialsRequest;
import com.MS_code_execution_platform.grpc.userauth.ValidateCredentialsResponse;
import com.MS_code_execution_platform.user_service.entity.User;
import com.MS_code_execution_platform.user_service.repository.UserRepository;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;
import net.devh.boot.grpc.server.service.GrpcService;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;
import java.util.UUID;

@GrpcService
@RequiredArgsConstructor
public class UserGrpcService extends UserAuthServiceGrpc.UserAuthServiceImplBase {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @Override
    public void validateCredentials(ValidateCredentialsRequest request,
                                     StreamObserver<ValidateCredentialsResponse> responseObserver) {

        Optional<User> userOpt = userRepository.findByEmail(request.getEmail());

        if (userOpt.isEmpty() || !passwordEncoder.matches(request.getPassword(), userOpt.get().getPassword())) {
            responseObserver.onNext(ValidateCredentialsResponse.newBuilder()
                    .setValid(false)
                    .setMessage("Invalid credentials")
                    .build());
            responseObserver.onCompleted();
            return;
        }

        User user = userOpt.get();
        responseObserver.onNext(ValidateCredentialsResponse.newBuilder()
                .setValid(true)
                .setUserId(user.getId().toString())
                .setEmail(user.getEmail())
                .setRole(user.getRole() == null ? "USER" : user.getRole())
                .build());
        responseObserver.onCompleted();
    }

    @Override
    public void registerUser(RegisterUserRequest request,
                              StreamObserver<RegisterUserResponse> responseObserver) {

        if (userRepository.existsByEmail(request.getEmail())) {
            responseObserver.onNext(RegisterUserResponse.newBuilder()
                    .setSuccess(false)
                    .setMessage("Email already exists")
                    .build());
            responseObserver.onCompleted();
            return;
        }

        User user = User.builder()
                .email(request.getEmail())
                .password(passwordEncoder.encode(request.getPassword()))
                .role("USER")
                .build();

        userRepository.save(user);

        responseObserver.onNext(RegisterUserResponse.newBuilder()
                .setSuccess(true)
                .setUserId(user.getId().toString())
                .setEmail(user.getEmail())
                .setRole(user.getRole())
                .build());
        responseObserver.onCompleted();
    }

    @Override
    public void getUser(GetUserRequest request, StreamObserver<GetUserResponse> responseObserver) {

        Optional<User> userOpt;
        try {
            userOpt = userRepository.findById(UUID.fromString(request.getUserId()));
        } catch (IllegalArgumentException e) {
            userOpt = Optional.empty();
        }

        if (userOpt.isEmpty()) {
            responseObserver.onNext(GetUserResponse.newBuilder()
                    .setFound(false)
                    .build());
            responseObserver.onCompleted();
            return;
        }

        User user = userOpt.get();
        responseObserver.onNext(GetUserResponse.newBuilder()
                .setFound(true)
                .setUserId(user.getId().toString())
                .setEmail(user.getEmail())
                .setRole(user.getRole() == null ? "USER" : user.getRole())
                .build());
        responseObserver.onCompleted();
    }
}
