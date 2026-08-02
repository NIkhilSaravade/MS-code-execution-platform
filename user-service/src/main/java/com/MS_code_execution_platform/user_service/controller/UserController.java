package com.MS_code_execution_platform.user_service.controller;

import com.MS_code_execution_platform.user_service.dto.RoleUpdateRequest;
import com.MS_code_execution_platform.user_service.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;


@RestController
@RequestMapping("/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @GetMapping("/{email}")
    public String getUserId(@PathVariable String email) {
        return userService.getUserIdByEmail(email);

    }

    // ADMIN-only, see SecurityConfig - promotes/demotes an existing user.
    @PatchMapping("/{email}/role")
    public void updateRole(@PathVariable String email, @RequestBody RoleUpdateRequest request) {
        userService.updateRole(email, request.getRole());
    }

}
