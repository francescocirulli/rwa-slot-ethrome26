// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DigitalSlotMachine} from "../src/DigitalSlotMachine.sol";
import {SlotPrize1155} from "../src/SlotPrize1155.sol";

contract DeployBase is Script {
    uint256 public constant BASE_MAINNET_CHAIN_ID = 8_453;
    address public constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant SLOT_OWNER = 0xC81f6728a10B20a8981d5C2601Aa185417229035;
    uint256 public constant TICKET_PRICE = 50_000;

    function run() external returns (SlotPrize1155 prizes, DigitalSlotMachine slot) {
        require(block.chainid == BASE_MAINNET_CHAIN_ID, "DeployBase: wrong chain");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        prizes = new SlotPrize1155(deployer);
        slot = new DigitalSlotMachine(SLOT_OWNER, deployer, IERC20(BASE_USDC), TICKET_PRICE);
        vm.stopBroadcast();
    }
}
