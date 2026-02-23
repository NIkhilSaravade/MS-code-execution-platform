package com.MS_code_execution_platform.worker_service.service;


import org.springframework.stereotype.Component;

@Component("python")
public class PythonExecutionStrategy implements LanguageStrategy {

    @Override
    public String getDockerImage() {
        return "python:3.10-alpine";
    }

    @Override
    public String buildCommand(String fileName) {
        return "python3 main.py";
    }

    @Override
    public String getFileExtension() {
        return ".py";
    }
}