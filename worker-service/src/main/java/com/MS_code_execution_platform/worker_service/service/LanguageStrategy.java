package com.MS_code_execution_platform.worker_service.service;

public interface LanguageStrategy {

    String getDockerImage();

    String buildCommand(String fileName);

    String getFileExtension();
}
