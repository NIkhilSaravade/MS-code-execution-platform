package com.MS_code_execution_platform.worker_service.service;


import com.MS_code_execution_platform.worker_service.util.FileUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.file.Path;

@Service
@RequiredArgsConstructor
public class CodeExecutionService {

    private final DockerExecutionService dockerExecutionService;

    public String execute(Long submissionId, String code, String language) {

        try {
            Path dir = FileUtils.createTempDirectory(submissionId);

            switch (language.toLowerCase()) {

                case "java":
                    FileUtils.writeCodeFile(dir, "Main.java", code);
                    return dockerExecutionService.execute(
                            dir,
                            "openjdk:17-alpine",
                            "javac Main.java && java Main"
                    );

                case "python":
                    FileUtils.writeCodeFile(dir, "main.py", code);
                    return dockerExecutionService.execute(
                            dir,
                            "python:3.10-alpine",
                            "python main.py"
                    );

                case "cpp":
                case "c++":
                    FileUtils.writeCodeFile(dir, "main.cpp", code);
                    return dockerExecutionService.execute(
                            dir,
                            "gcc:12-alpine",
                            "g++ main.cpp -o main && ./main"
                    );

                default:
                    return "Unsupported Language";
            }

        } catch (Exception e) {
            return "Execution Error: " + e.getMessage();
        }
    }
}
