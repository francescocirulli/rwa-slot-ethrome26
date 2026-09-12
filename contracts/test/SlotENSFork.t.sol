// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {SlotENSRegistrar, IENSRegistryV2, IENSFactoryV2} from "../src/SlotENSRegistrar.sol";
interface IRootRoles {function initialize(address,uint256) external;function grantRootRoles(uint256,address) external returns(bool);}
interface IAddr {function addr(bytes32) external view returns(address);function hasRootRoles(uint256,address) external view returns(bool);}
contract SlotENSForkTest is Test {
    function testActualSepoliaRegistryFactoryAndResolver() public {
        address factory=address(bytes20(hex"10dc6333cdfe1fcef624c6e0a8221b91804cd7ef"));
        if(factory.code.length==0){vm.skip(true);return;}
        address registryImpl=address(bytes20(hex"624a25d67b59d587752ebec8dded8827dae52050"));
        address resolverImpl=address(bytes20(hex"9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e"));
        uint256 all=0x1111111111111111111111111111111111111111111111111111111111111111;
        address backend=address(0xBEEF);address player=address(0xCAFE);
        vm.startPrank(backend);
        address registry=IENSFactoryV2(factory).deployProxy(registryImpl,991,abi.encodeCall(IRootRoles.initialize,(backend,all)));
        bytes32 parent=keccak256("parent");
        SlotENSRegistrar registrar=new SlotENSRegistrar(backend,registry,factory,resolverImpl,parent,uint64(block.timestamp+365 days));
        IRootRoles(registry).grantRootRoles(1,address(registrar));
        bytes32 id=keccak256("fork-claim");registrar.reserve(id,player,"frank");registrar.fulfill(id,keccak256("verified-source"));
        vm.stopPrank();
        SlotENSRegistrar.Claim memory c=registrar.claim(id);
        assertEq(IENSRegistryV2(registry).getOwner(uint256(keccak256("frank"))),player);
        assertEq(IAddr(c.resolver).addr(keccak256(abi.encodePacked(parent,keccak256("frank")))),player);
        assertTrue(IAddr(c.resolver).hasRootRoles(all,player));
        assertFalse(IAddr(c.resolver).hasRootRoles(1,address(registrar)));
    }
}
