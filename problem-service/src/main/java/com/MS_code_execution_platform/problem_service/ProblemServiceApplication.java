package com.MS_code_execution_platform.problem_service;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

@SpringBootApplication
@EnableDiscoveryClient
public class ProblemServiceApplication {

	public static void main(String[] args) {
		SpringApplication.run(ProblemServiceApplication.class, args);
	}

}
