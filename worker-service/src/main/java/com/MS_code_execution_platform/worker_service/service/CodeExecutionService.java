package com.MS_code_execution_platform.worker_service.service;

import com.MS_code_execution_platform.worker_service.util.FileUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.file.Path;

@Service
@RequiredArgsConstructor
public class CodeExecutionService {

    private final DockerExecutionService dockerExecutionService;

    public String execute(Long submissionId,
                          String code,
                          String language,
                          String input) {

        try {
            Path dir = FileUtils.createTempDirectory(submissionId);

            switch (language.toLowerCase()) {

                case "python":
                    FileUtils.writeCodeFile(dir, "main.py", code);
                    FileUtils.writeCodeFile(dir, "input.txt", input);

                    return dockerExecutionService.execute(
                            dir.toAbsolutePath().toString(),
                            "python:3.10",
                            "python main.py < input.txt"
                    );
                case "java":
                    FileUtils.writeCodeFile(dir, "Main.java", code);
                    FileUtils.writeCodeFile(dir, "input.txt", input);

                    return dockerExecutionService.execute(
                            dir.toAbsolutePath().toString(),
                            "eclipse-temurin:17",
                            "javac Main.java && java Main < input.txt"
                    );
                case "cpp":
                case "c++":
                    FileUtils.writeCodeFile(dir, "main.cpp", code);
                    FileUtils.writeCodeFile(dir, "input.txt", input);

                    return dockerExecutionService.execute(
                            dir.toAbsolutePath().toString(),
                            "gcc:12",
                            "g++ main.cpp -o main && ./main < input.txt"
                    );

                default:
                    return "Unsupported Language";
            }

        } catch (Exception e) {
            return "Execution Error: " + e.getMessage();
        }
    }
}