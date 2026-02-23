package com.MS_code_execution_platform.worker_service.service;


import org.springframework.stereotype.Component;

@Component("java")
public class JavaExecutionStrategy implements LanguageStrategy {

    @Override
    public String getDockerImage() {
        return "openjdk:17-alpine";
    }

    @Override
    public String buildCommand(String fileName) {
        return "javac Main.java && java Main";
    }

    @Override
    public String getFileExtension() {
        return ".java";
    }
}
