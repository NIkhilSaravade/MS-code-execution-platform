package com.MS_code_execution_platform.worker_service.service;


import com.MS_code_execution_platform.worker_service.dto.SubmissionRequest;
import org.springframework.stereotype.Service;

import java.io.File;
import java.nio.file.Files;
@Service
public class DockerSandboxService {

    public String execute(SubmissionRequest request, LanguageStrategy strategy) {

        try {

            File tempDir = Files.createTempDirectory("code").toFile();
            File codeFile = new File(tempDir, "main" + strategy.getFileExtension());

            Files.writeString(codeFile.toPath(), request.getCode());

            ProcessBuilder builder = new ProcessBuilder(
                    "docker", "run", "--rm",
                    "--memory=256m",
                    "--cpus=0.5",
                    "--network=none",
                    "--pids-limit=64",
                    "--security-opt=no-new-privileges",
                    "-v", tempDir.getAbsolutePath() + ":/app",
                    "-w", "/app",
                    strategy.getDockerImage(),
                    "sh", "-c", strategy.buildCommand(codeFile.getName())
            );

            return TimeoutExecutor.execute(builder, 5000);

        } catch (Exception e) {
            throw new RuntimeException("Execution Failed: " + e.getMessage());
        }
    }
}