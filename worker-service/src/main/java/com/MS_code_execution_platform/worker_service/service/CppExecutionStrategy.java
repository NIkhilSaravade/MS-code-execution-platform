package com.MS_code_execution_platform.worker_service.service;


import org.springframework.stereotype.Component;

@Component("cpp")
public class CppExecutionStrategy implements LanguageStrategy {

    @Override
    public String getDockerImage() {
        return "gcc:latest";
    }

    @Override
    public String buildCommand(String fileName) {
        return "g++ main.cpp -o main && ./main";
    }

    @Override
    public String getFileExtension() {
        return ".cpp";
    }
}